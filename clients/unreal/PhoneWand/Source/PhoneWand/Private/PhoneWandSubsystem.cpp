// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandSubsystem.h"

#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "IWebSocket.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Modules/ModuleManager.h"
#include "PhoneWandLibrary.h"
#include "PhoneWandLog.h"
#include "PhoneWandSettings.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "WebSocketsModule.h"

namespace
{
	constexpr float MinRetryDelay = 0.5f;
	constexpr float MaxRetryDelay = 5.0f;

	EPhoneWandPlayerState ParseState(const FString& S)
	{
		if (S == TEXT("active")) return EPhoneWandPlayerState::Active;
		if (S == TEXT("paused")) return EPhoneWandPlayerState::Paused;
		return EPhoneWandPlayerState::Waiting;
	}

	EPhoneWandCalibration ParseCalibration(const FString& S)
	{
		if (S == TEXT("ray")) return EPhoneWandCalibration::Ray;
		if (S == TEXT("screen")) return EPhoneWandCalibration::Screen;
		return EPhoneWandCalibration::None;
	}

	EPhoneWandCalibrationStep ParseStep(const FString& S)
	{
		if (S == TEXT("top-left")) return EPhoneWandCalibrationStep::TopLeft;
		if (S == TEXT("bottom-right")) return EPhoneWandCalibrationStep::BottomRight;
		if (S == TEXT("cancelled")) return EPhoneWandCalibrationStep::Cancelled;
		return EPhoneWandCalibrationStep::None;
	}

	bool ReadNumbers(const FJsonObject& Obj, const TCHAR* Field, double* Out, int32 Count)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (!Obj.TryGetArrayField(Field, Arr) || Arr == nullptr || Arr->Num() < Count)
		{
			return false;
		}
		for (int32 i = 0; i < Count; ++i)
		{
			double V = 0.0;
			if (!(*Arr)[i].IsValid() || !(*Arr)[i]->TryGetNumber(V))
			{
				return false;
			}
			Out[i] = V;
		}
		return true;
	}

	FPhoneWandPose ParsePose(const FJsonObject& Msg)
	{
		FPhoneWandPose Pose;
		Msg.TryGetStringField(TEXT("id"), Pose.Id);
		Msg.TryGetNumberField(TEXT("seq"), Pose.Seq);
		Msg.TryGetNumberField(TEXT("t"), Pose.Time);
		Msg.TryGetNumberField(TEXT("yaw"), Pose.Yaw);
		Msg.TryGetNumberField(TEXT("pitch"), Pose.Pitch);
		Msg.TryGetNumberField(TEXT("roll"), Pose.Roll);

		double Q[4] = { 0.0, 0.0, 0.0, 1.0 };
		ReadNumbers(Msg, TEXT("q"), Q, 4);
		Pose.RigQuat = FVector4(Q[0], Q[1], Q[2], Q[3]);
		Pose.Rotation = UPhoneWandLibrary::RigToUnrealQuat(Pose.RigQuat);
		Pose.Rotator = Pose.Rotation.Rotator();

		double D[3] = { 0.0, 0.0, 1.0 };
		ReadNumbers(Msg, TEXT("dir"), D, 3);
		Pose.RigDirection = FVector(D[0], D[1], D[2]);
		Pose.Direction = UPhoneWandLibrary::RigToUnrealVector(Pose.RigDirection);

		double S[2] = { 0.0, 0.0 };
		Pose.bHasScreen = ReadNumbers(Msg, TEXT("screen"), S, 2);
		Pose.Screen = Pose.bHasScreen ? FVector2D(S[0], S[1]) : FVector2D::ZeroVector;
		return Pose;
	}

	FString ToJsonString(const TSharedRef<FJsonObject>& Msg)
	{
		FString Out;
		TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
			TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
		FJsonSerializer::Serialize(Msg, Writer);
		return Out;
	}
}

namespace PhoneWand
{
	FString ToString(EPhoneWandPlayerState State)
	{
		switch (State)
		{
		case EPhoneWandPlayerState::Active: return TEXT("active");
		case EPhoneWandPlayerState::Paused: return TEXT("paused");
		default: return TEXT("waiting");
		}
	}

	FString ToString(EPhoneWandCalibration Calibration)
	{
		switch (Calibration)
		{
		case EPhoneWandCalibration::Ray: return TEXT("ray");
		case EPhoneWandCalibration::Screen: return TEXT("screen");
		default: return TEXT("none");
		}
	}

	FString ToString(EPhoneWandCalibrationStep Step)
	{
		switch (Step)
		{
		case EPhoneWandCalibrationStep::TopLeft: return TEXT("top-left");
		case EPhoneWandCalibrationStep::BottomRight: return TEXT("bottom-right");
		case EPhoneWandCalibrationStep::Cancelled: return TEXT("cancelled");
		default: return FString();
		}
	}
}

// ---------------------------------------------------------------------- lifecycle

void UPhoneWandSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	const UPhoneWandSettings* Settings = GetDefault<UPhoneWandSettings>();
	bAutoReconnect = Settings->bAutoReconnect;
	SmoothingMode = Settings->Smoothing;
	SmoothMinCutoff = Settings->MinCutoff;
	SmoothBeta = Settings->Beta;
	SmoothDCutoff = Settings->DCutoff;

	if (Settings->bAutoConnect && !FParse::Param(FCommandLine::Get(), TEXT("PhoneWandNoConnect")))
	{
		Connect();
	}
}

void UPhoneWandSubsystem::Deinitialize()
{
	bClosedByUser = true;
	CancelReconnect();
	CloseSocket();
	Players.Empty();
	bHasHello = false;
	Super::Deinitialize();
}

void UPhoneWandSubsystem::BeginDestroy()
{
	CancelReconnect();
	CloseSocket();
	Super::BeginDestroy();
}

// ---------------------------------------------------------------------- connection

void UPhoneWandSubsystem::Connect(const FString& Url)
{
	FString Target = Url;
	if (Target.IsEmpty())
	{
		FString Override;
		if (FParse::Value(FCommandLine::Get(), TEXT("PhoneWandUrl="), Override) && !Override.IsEmpty())
		{
			Target = Override;
		}
		else
		{
			Target = GetDefault<UPhoneWandSettings>()->Url;
		}
	}
	if (Target.IsEmpty())
	{
		Target = PHONEWAND_DEFAULT_URL;
	}

	bClosedByUser = false;
	if (Socket.IsValid() && Target == CurrentUrl)
	{
		return;
	}
	if (Socket.IsValid())
	{
		// A different URL: drop the old connection first.
		CloseSocket();
		HandleConnectionLost();
	}
	CurrentUrl = Target;
	CancelReconnect();
	RetryDelay = MinRetryDelay;
	OpenSocket();
}

void UPhoneWandSubsystem::Disconnect()
{
	bClosedByUser = true;
	CancelReconnect();
	CloseSocket();
	HandleConnectionLost();
}

void UPhoneWandSubsystem::OpenSocket()
{
	if (Socket.IsValid())
	{
		return;
	}
	FWebSocketsModule& Module = FModuleManager::LoadModuleChecked<FWebSocketsModule>(TEXT("WebSockets"));
	Socket = Module.CreateWebSocket(CurrentUrl);
	Socket->OnConnected().AddUObject(this, &UPhoneWandSubsystem::OnSocketConnected);
	Socket->OnConnectionError().AddUObject(this, &UPhoneWandSubsystem::OnSocketError);
	Socket->OnClosed().AddUObject(this, &UPhoneWandSubsystem::OnSocketClosed);
	Socket->OnMessage().AddUObject(this, &UPhoneWandSubsystem::OnSocketMessage);
	UE_LOG(LogPhoneWand, Verbose, TEXT("Connecting to %s"), *CurrentUrl);
	Socket->Connect();
}

void UPhoneWandSubsystem::CloseSocket()
{
	bSocketOpen = false;
	if (!Socket.IsValid())
	{
		return;
	}
	TSharedPtr<IWebSocket> Old = MoveTemp(Socket);
	Socket.Reset();
	Old->OnConnected().RemoveAll(this);
	Old->OnConnectionError().RemoveAll(this);
	Old->OnClosed().RemoveAll(this);
	Old->OnMessage().RemoveAll(this);
	Old->Close();
}

void UPhoneWandSubsystem::ScheduleReconnect()
{
	if (!bAutoReconnect || bClosedByUser || ReconnectHandle.IsValid())
	{
		return;
	}
	ReconnectHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UPhoneWandSubsystem::OnReconnectTimer), RetryDelay);
	RetryDelay = FMath::Min(RetryDelay * 2.0f, MaxRetryDelay);
}

void UPhoneWandSubsystem::CancelReconnect()
{
	if (ReconnectHandle.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(ReconnectHandle);
		ReconnectHandle.Reset();
	}
}

bool UPhoneWandSubsystem::OnReconnectTimer(float DeltaTime)
{
	ReconnectHandle.Reset();
	if (!bClosedByUser)
	{
		OpenSocket();
	}
	return false; // one shot
}

// Socket callbacks. The engine's WebSocket implementations deliver these on the game thread, but
// that is not a documented guarantee, so anything arriving elsewhere is bounced there.
void UPhoneWandSubsystem::OnSocketConnected()
{
	if (!IsInGameThread())
	{
		TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
		AsyncTask(ENamedThreads::GameThread, [Weak]() { if (Weak.IsValid()) { Weak->OnSocketConnected(); } });
		return;
	}
	UE_LOG(LogPhoneWand, Log, TEXT("Connected to %s"), *CurrentUrl);
	bSocketOpen = true;
	RetryDelay = MinRetryDelay;
	SendConfigure();
}

void UPhoneWandSubsystem::OnSocketError(const FString& Error)
{
	if (!IsInGameThread())
	{
		TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
		AsyncTask(ENamedThreads::GameThread, [Weak, Error]() { if (Weak.IsValid()) { Weak->OnSocketError(Error); } });
		return;
	}
	UE_LOG(LogPhoneWand, Verbose, TEXT("Connection to %s failed: %s"), *CurrentUrl, *Error);
	CloseSocket();
	HandleConnectionLost();
	ScheduleReconnect();
}

void UPhoneWandSubsystem::OnSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean)
{
	if (!IsInGameThread())
	{
		TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
		AsyncTask(ENamedThreads::GameThread, [Weak, StatusCode, Reason, bWasClean]() { if (Weak.IsValid()) { Weak->OnSocketClosed(StatusCode, Reason, bWasClean); } });
		return;
	}
	UE_LOG(LogPhoneWand, Log, TEXT("Connection to %s closed (%d %s)"), *CurrentUrl, StatusCode, *Reason);
	CloseSocket();
	HandleConnectionLost();
	ScheduleReconnect();
}

void UPhoneWandSubsystem::OnSocketMessage(const FString& Message)
{
	if (!IsInGameThread())
	{
		TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
		AsyncTask(ENamedThreads::GameThread, [Weak, Message]() { if (Weak.IsValid()) { Weak->OnSocketMessage(Message); } });
		return;
	}
	HandleMessage(Message);
}

// ---------------------------------------------------------------------- players

TArray<FPhoneWandPlayer> UPhoneWandSubsystem::GetPlayers() const
{
	TArray<FPhoneWandPlayer> Out;
	Players.GenerateValueArray(Out);
	Out.Sort([](const FPhoneWandPlayer& A, const FPhoneWandPlayer& B) { return A.Slot < B.Slot; });
	return Out;
}

bool UPhoneWandSubsystem::GetPlayer(const FString& Id, FPhoneWandPlayer& Player) const
{
	if (const FPhoneWandPlayer* P = Players.Find(Id))
	{
		Player = *P;
		return true;
	}
	return false;
}

bool UPhoneWandSubsystem::GetPlayerInSlot(int32 Slot, FPhoneWandPlayer& Player) const
{
	for (const TPair<FString, FPhoneWandPlayer>& Pair : Players)
	{
		if (Pair.Value.Slot == Slot)
		{
			Player = Pair.Value;
			return true;
		}
	}
	return false;
}

bool UPhoneWandSubsystem::IsButtonHeld(const FString& Id, const FString& Button) const
{
	const FPhoneWandPlayer* P = Players.Find(Id);
	return P != nullptr && P->Buttons.Contains(Button);
}

// ---------------------------------------------------------------------- app to relay

void UPhoneWandSubsystem::SendJson(const TSharedRef<FJsonObject>& Msg)
{
	if (Socket.IsValid() && bSocketOpen && Socket->IsConnected())
	{
		Socket->Send(ToJsonString(Msg));
	}
}

void UPhoneWandSubsystem::SendConfigure()
{
	if (SmoothingMode == EPhoneWandSmoothingMode::RelayDefault)
	{
		return;
	}
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("configure"));
	if (SmoothingMode == EPhoneWandSmoothingMode::Raw)
	{
		Msg->SetBoolField(TEXT("smoothing"), false);
	}
	else
	{
		TSharedRef<FJsonObject> S = MakeShared<FJsonObject>();
		S->SetNumberField(TEXT("minCutoff"), SmoothMinCutoff);
		S->SetNumberField(TEXT("beta"), SmoothBeta);
		S->SetNumberField(TEXT("dCutoff"), SmoothDCutoff);
		Msg->SetObjectField(TEXT("smoothing"), S);
	}
	SendJson(Msg);
}

void UPhoneWandSubsystem::SetSmoothing(float MinCutoff, float Beta, float DCutoff)
{
	SmoothingMode = EPhoneWandSmoothingMode::Custom;
	SmoothMinCutoff = MinCutoff;
	SmoothBeta = Beta;
	SmoothDCutoff = DCutoff;
	SendConfigure();
}

void UPhoneWandSubsystem::SetRaw()
{
	SmoothingMode = EPhoneWandSmoothingMode::Raw;
	SendConfigure();
}

void UPhoneWandSubsystem::Style(const FString& Id, const FString& Colour, const FString& Label)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("style"));
	Msg->SetStringField(TEXT("id"), Id);
	if (!Colour.IsEmpty())
	{
		Msg->SetStringField(TEXT("colour"), Colour.ToLower());
	}
	if (!Label.IsEmpty())
	{
		Msg->SetStringField(TEXT("label"), Label);
	}
	SendJson(Msg);
}

void UPhoneWandSubsystem::StyleColour(const FString& Id, FLinearColor Colour)
{
	Style(Id, UPhoneWandLibrary::ColourToHex(Colour));
}

void UPhoneWandSubsystem::SetLabel(const FString& Id, const FString& Label)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("style"));
	Msg->SetStringField(TEXT("id"), Id);
	Msg->SetStringField(TEXT("label"), Label);
	SendJson(Msg);
}

void UPhoneWandSubsystem::Prompt(const FString& Text, const FString& Id, int32 DurationMs)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("prompt"));
	Msg->SetStringField(TEXT("text"), Text);
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	Msg->SetNumberField(TEXT("duration"), FMath::Max(0, DurationMs));
	SendJson(Msg);
}

void UPhoneWandSubsystem::Haptic(const TArray<int32>& Pattern, const FString& Id)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("haptic"));
	TArray<TSharedPtr<FJsonValue>> Values;
	for (int32 Ms : Pattern)
	{
		Values.Add(MakeShared<FJsonValueNumber>(FMath::Max(0, Ms)));
	}
	Msg->SetArrayField(TEXT("pattern"), Values);
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	SendJson(Msg);
}

void UPhoneWandSubsystem::HapticPulse(int32 DurationMs, const FString& Id)
{
	Haptic({ DurationMs }, Id);
}

void UPhoneWandSubsystem::Calibrate(EPhoneWandCalibrateMode Mode, const FString& Id)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("calibrate"));
	Msg->SetStringField(TEXT("mode"), Mode == EPhoneWandCalibrateMode::Ray ? TEXT("ray") : TEXT("screen"));
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	SendJson(Msg);
}

// ---------------------------------------------------------------------- relay to app

void UPhoneWandSubsystem::HandleConnectionLost()
{
	const bool bWas = bHasHello;
	bHasHello = false;
	Hello = FPhoneWandHello();
	TArray<FPhoneWandPlayer> Gone;
	Players.GenerateValueArray(Gone);
	Players.Empty();
	for (const FPhoneWandPlayer& P : Gone)
	{
		OnPlayerLeft.Broadcast(P);
		OnPlayerLeftNative.Broadcast(P);
	}
	if (bWas)
	{
		OnDisconnected.Broadcast();
		OnDisconnectedNative.Broadcast();
	}
}

void UPhoneWandSubsystem::HandleMessage(const FString& Json)
{
	TSharedPtr<FJsonObject> Msg;
	TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Json);
	if (!FJsonSerializer::Deserialize(Reader, Msg) || !Msg.IsValid())
	{
		return;
	}
	HandleMessageObject(*Msg);
}

FPhoneWandPlayer& UPhoneWandSubsystem::Upsert(const FJsonObject& Info)
{
	FString Id;
	Info.TryGetStringField(TEXT("id"), Id);
	FPhoneWandPlayer& P = Players.FindOrAdd(Id);
	P.Id = Id;

	// Only fields present in the message change, like Object.assign in the reference client.
	int32 Slot = 0;
	if (Info.TryGetNumberField(TEXT("slot"), Slot)) P.Slot = Slot;
	FString S;
	if (Info.TryGetStringField(TEXT("name"), S)) P.Name = S;
	if (Info.TryGetStringField(TEXT("colour"), S))
	{
		P.Colour = S;
		P.LinearColour = UPhoneWandLibrary::ColourFromHex(S);
	}
	if (Info.TryGetStringField(TEXT("label"), S)) P.Label = S;
	if (Info.TryGetStringField(TEXT("state"), S)) P.State = ParseState(S);
	if (Info.TryGetStringField(TEXT("calibration"), S)) P.Calibration = ParseCalibration(S);
	const TSharedPtr<FJsonObject>* Device = nullptr;
	if (Info.TryGetObjectField(TEXT("device"), Device) && Device != nullptr && Device->IsValid())
	{
		if ((*Device)->TryGetStringField(TEXT("platform"), S)) P.Platform = S;
		if ((*Device)->TryGetStringField(TEXT("sensor"), S)) P.Sensor = S;
		if ((*Device)->TryGetStringField(TEXT("transport"), S)) P.Transport = S;
	}
	return P;
}

void UPhoneWandSubsystem::HandleMessageObject(const FJsonObject& Msg)
{
	FString Type;
	if (!Msg.TryGetStringField(TEXT("type"), Type))
	{
		return;
	}

	auto FindById = [this, &Msg]() -> FPhoneWandPlayer*
	{
		FString Id;
		return Msg.TryGetStringField(TEXT("id"), Id) ? Players.Find(Id) : nullptr;
	};

	if (Type == TEXT("hello"))
	{
		FPhoneWandHello H;
		Msg.TryGetNumberField(TEXT("protocol"), H.Protocol);
		Msg.TryGetStringField(TEXT("relay"), H.Relay);
		Msg.TryGetStringField(TEXT("joinUrl"), H.JoinUrl);
		Msg.TryGetStringField(TEXT("qrUrl"), H.QrUrl);
		Msg.TryGetNumberField(TEXT("maxPlayers"), H.MaxPlayers);
		Hello = H;
		bHasHello = true;
		if (H.Protocol != PHONEWAND_PROTOCOL_VERSION)
		{
			UE_LOG(LogPhoneWand, Warning, TEXT("Relay speaks protocol %d; this plugin speaks %d"), H.Protocol, PHONEWAND_PROTOCOL_VERSION);
		}
		OnConnected.Broadcast(H);
		OnConnectedNative.Broadcast(H);

		const TArray<TSharedPtr<FJsonValue>>* List = nullptr;
		if (Msg.TryGetArrayField(TEXT("players"), List) && List != nullptr)
		{
			for (const TSharedPtr<FJsonValue>& V : *List)
			{
				const TSharedPtr<FJsonObject>* Info = nullptr;
				if (V.IsValid() && V->TryGetObject(Info) && Info != nullptr && Info->IsValid())
				{
					const FPhoneWandPlayer P = Upsert(**Info);
					OnPlayerJoined.Broadcast(P);
					OnPlayerJoinedNative.Broadcast(P);
				}
			}
		}
	}
	else if (Type == TEXT("join"))
	{
		const TSharedPtr<FJsonObject>* Info = nullptr;
		if (Msg.TryGetObjectField(TEXT("player"), Info) && Info != nullptr && Info->IsValid())
		{
			const FPhoneWandPlayer P = Upsert(**Info);
			OnPlayerJoined.Broadcast(P);
			OnPlayerJoinedNative.Broadcast(P);
		}
	}
	else if (Type == TEXT("player"))
	{
		const TSharedPtr<FJsonObject>* Info = nullptr;
		if (Msg.TryGetObjectField(TEXT("player"), Info) && Info != nullptr && Info->IsValid())
		{
			FPhoneWandPlayer& Live = Upsert(**Info);
			if (Live.State != EPhoneWandPlayerState::Active)
			{
				Live.Buttons.Empty();
			}
			const FPhoneWandPlayer P = Live;
			OnPlayerChanged.Broadcast(P);
			OnPlayerChangedNative.Broadcast(P);
		}
	}
	else if (Type == TEXT("leave"))
	{
		FString Id;
		if (!Msg.TryGetStringField(TEXT("id"), Id))
		{
			return;
		}
		FPhoneWandPlayer P;
		if (!Players.RemoveAndCopyValue(Id, P))
		{
			return;
		}
		OnPlayerLeft.Broadcast(P);
		OnPlayerLeftNative.Broadcast(P);
	}
	else if (Type == TEXT("pose"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		const FPhoneWandPose Pose = ParsePose(Msg);
		Live->Pose = Pose;
		Live->bHasPose = true;
		const FPhoneWandPlayer P = *Live;
		OnPose.Broadcast(P, Pose);
		OnPoseNative.Broadcast(P, Pose);
	}
	else if (Type == TEXT("button"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		FString Button;
		Msg.TryGetStringField(TEXT("button"), Button);
		bool bDown = false;
		Msg.TryGetBoolField(TEXT("down"), bDown);
		if (bDown)
		{
			Live->Buttons.AddUnique(Button);
			Live->Buttons.Sort();
		}
		else
		{
			Live->Buttons.Remove(Button);
		}
		const FPhoneWandPlayer P = *Live;
		OnButton.Broadcast(P, Button, bDown);
		OnButtonNative.Broadcast(P, Button, bDown);
	}
	else if (Type == TEXT("calibrating"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		FString StepName;
		Msg.TryGetStringField(TEXT("step"), StepName);
		const EPhoneWandCalibrationStep Step = ParseStep(StepName);
		Live->Calibrating = Step == EPhoneWandCalibrationStep::Cancelled ? EPhoneWandCalibrationStep::None : Step;
		const FPhoneWandPlayer P = *Live;
		OnCalibrating.Broadcast(P, Step);
		OnCalibratingNative.Broadcast(P, Step);
	}
	else if (Type == TEXT("calibrated"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		FString Name;
		Msg.TryGetStringField(TEXT("calibration"), Name);
		Live->Calibration = ParseCalibration(Name);
		Live->Calibrating = EPhoneWandCalibrationStep::None;
		const FPhoneWandPlayer P = *Live;
		OnCalibrated.Broadcast(P, P.Calibration);
		OnCalibratedNative.Broadcast(P, P.Calibration);
	}
	else if (Type == TEXT("stats"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		FPhoneWandStats Stats;
		Stats.Id = Live->Id;
		Msg.TryGetNumberField(TEXT("rtt"), Stats.Rtt);
		Msg.TryGetNumberField(TEXT("rate"), Stats.Rate);
		Msg.TryGetNumberField(TEXT("dropped"), Stats.Dropped);
		Live->Stats = Stats;
		Live->bHasStats = true;
		const FPhoneWandPlayer P = *Live;
		OnStats.Broadcast(P, Stats);
		OnStatsNative.Broadcast(P, Stats);
	}
	// Unknown message types are ignored, as the protocol requires.
}
