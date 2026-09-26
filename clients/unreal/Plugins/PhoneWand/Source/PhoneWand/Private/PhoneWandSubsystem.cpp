// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandSubsystem.h"

#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Interfaces/IPluginManager.h"
#include "IWebSocket.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "PhoneWandLibrary.h"
#include "PhoneWandLog.h"
#include "PhoneWandSettings.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "WebSocketsModule.h"

// Starting the relay needs a platform that can run other programs: desktop Windows, macOS, Linux.
#if PLATFORM_WINDOWS || PLATFORM_MAC || PLATFORM_LINUX
#define PHONEWAND_CAN_START_RELAY 1
#else
#define PHONEWAND_CAN_START_RELAY 0
#endif

#if PLATFORM_MAC || PLATFORM_LINUX
#include <sys/stat.h>
#endif

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

	bStartRelay = Settings->bStartRelay || FParse::Param(FCommandLine::Get(), TEXT("PhoneWandStartRelay"));
	RelayPathSetting = Settings->RelayPath;
	FParse::Value(FCommandLine::Get(), TEXT("PhoneWandRelayPath="), RelayPathSetting);
	RelayArgumentsSetting = Settings->RelayArguments;
	FParse::Value(FCommandLine::Get(), TEXT("PhoneWandRelayArgs="), RelayArgumentsSetting, /*bShouldStopOnSeparator*/ false);

	if (Settings->bAutoConnect && !FParse::Param(FCommandLine::Get(), TEXT("PhoneWandNoConnect")))
	{
		Connect();
	}
}

void UPhoneWandSubsystem::Deinitialize()
{
	bClosedByUser = true;
	CancelReconnect();
	CancelRelayCheck();
	CloseSocket();
	Players.Empty();
	bHasHello = false;
	StopRelay();
	Super::Deinitialize();
}

void UPhoneWandSubsystem::BeginDestroy()
{
	CancelReconnect();
	CancelRelayCheck();
	CloseSocket();
	StopRelay();
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
	if ((Socket.IsValid() || RelayCheck.IsValid()) && Target == CurrentUrl)
	{
		return;
	}
	CancelRelayCheck();
	if (Socket.IsValid())
	{
		// A different URL: drop the old connection first.
		CloseSocket();
		HandleConnectionLost();
	}
	CurrentUrl = Target;
	CancelReconnect();
	RetryDelay = MinRetryDelay;
	if (!BeginManagedRelay())
	{
		OpenSocket();
	}
}

void UPhoneWandSubsystem::Disconnect()
{
	bClosedByUser = true;
	CancelReconnect();
	CancelRelayCheck();
	CloseSocket();
	HandleConnectionLost();
	StopRelay();
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

// ---------------------------------------------------------------------- managed relay
//
// Follows docs/shipping.md ("What the client libraries do"), like startRelay in the Node client:
// only for a relay on this computer; use one that is already running; otherwise start
// phone-wand-relay/<platform>/phone-wand-relay hidden, with a pipe as its standard input (the
// lifeline); stop it when the game stops. A relay this subsystem did not start is never stopped.

void UPhoneWandSubsystem::SetStartRelay(bool bEnabled, const FString& RelayPath, const FString& RelayArguments)
{
	bStartRelay = bEnabled;
	RelayPathSetting = RelayPath;
	RelayArgumentsSetting = RelayArguments;
}

FString UPhoneWandSubsystem::GetRelayPlatform()
{
#if PLATFORM_MAC
	return TEXT("macos");
#elif PLATFORM_WINDOWS && PLATFORM_CPU_X86_FAMILY
	return TEXT("windows-x64");
#elif PLATFORM_LINUX && PLATFORM_CPU_ARM_FAMILY
	return TEXT("linux-arm64");
#elif PLATFORM_LINUX
	return TEXT("linux-x64");
#else
	return FString();
#endif
}

FString UPhoneWandSubsystem::ResolveRelayExecutable(const FString& RelayPath)
{
	FString Path = RelayPath.TrimStartAndEnd().TrimQuotes();
	if (Path.IsEmpty())
	{
		TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("PhoneWand"));
		if (!Plugin.IsValid())
		{
			return FString();
		}
		Path = FPaths::Combine(Plugin->GetBaseDir(), TEXT("Resources"), TEXT("Relay"), TEXT("phone-wand-relay"));
	}
	else if (FPaths::IsRelative(Path))
	{
		Path = FPaths::Combine(FPaths::ProjectDir(), Path);
	}
	Path = FPaths::ConvertRelativePathToFull(Path);
	FPaths::CollapseRelativeDirectories(Path);
	if (FPaths::FileExists(Path))
	{
		return Path; // the executable itself
	}
	const FString Platform = GetRelayPlatform();
	if (Platform.IsEmpty())
	{
		return FString();
	}
	return FPaths::Combine(Path, Platform, PLATFORM_WINDOWS ? TEXT("phone-wand-relay.exe") : TEXT("phone-wand-relay"));
}

bool UPhoneWandSubsystem::ParseLocalRelayUrl(const FString& Url, int32& OutPort)
{
	OutPort = 0;
	FString Rest = Url.TrimStartAndEnd();
	int32 SchemeEnd = Rest.Find(TEXT("://"));
	if (SchemeEnd != INDEX_NONE)
	{
		Rest.RightChopInline(SchemeEnd + 3);
	}
	int32 PathStart = INDEX_NONE;
	if (Rest.FindChar(TEXT('/'), PathStart))
	{
		Rest.LeftInline(PathStart);
	}
	int32 At = INDEX_NONE;
	if (Rest.FindLastChar(TEXT('@'), At))
	{
		Rest.RightChopInline(At + 1);
	}

	FString Host;
	FString Port;
	if (Rest.StartsWith(TEXT("[")))
	{
		int32 Close = INDEX_NONE;
		if (!Rest.FindChar(TEXT(']'), Close))
		{
			return false;
		}
		Host = Rest.Left(Close + 1);
		const FString After = Rest.RightChop(Close + 1);
		if (After.StartsWith(TEXT(":")))
		{
			Port = After.RightChop(1);
		}
	}
	else if (!Rest.Split(TEXT(":"), &Host, &Port))
	{
		Host = Rest;
	}

	Host.ToLowerInline();
	if (Host != TEXT("127.0.0.1") && Host != TEXT("localhost") && Host != TEXT("[::1]"))
	{
		return false;
	}
	OutPort = 8480;
	if (!Port.IsEmpty())
	{
		if (!Port.IsNumeric())
		{
			return false;
		}
		OutPort = FCString::Atoi(*Port);
	}
	return OutPort > 0 && OutPort < 65536;
}

bool UPhoneWandSubsystem::IsRelayStartedByPlugin() const
{
	FProcHandle Proc = RelayProc;
	return Proc.IsValid() && FPlatformProcess::IsProcRunning(Proc);
}

bool UPhoneWandSubsystem::BeginManagedRelay()
{
	if (!bStartRelay)
	{
		return false;
	}
	int32 Port = 0;
	if (!ParseLocalRelayUrl(CurrentUrl, Port))
	{
		UE_LOG(LogPhoneWand, Log, TEXT("Start Relay is on, but %s is not a relay on this computer, so none is started."), *CurrentUrl);
		return false;
	}
#if !PHONEWAND_CAN_START_RELAY
	UE_LOG(LogPhoneWand, Warning, TEXT("Start Relay is ignored: this platform cannot start programs. Run the relay on a computer and connect to it."));
	return false;
#else
	if (RelayProc.IsValid())
	{
		if (RelayPort == Port && IsRelayStartedByPlugin())
		{
			return false; // ours, already running on this port
		}
		StopRelay();
	}

	// Is a relay already there (the Phone Wand app, or one started by hand)? Asked without
	// blocking the game thread; the socket opens when the answer (or the one second timeout) comes.
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(FString::Printf(TEXT("http://127.0.0.1:%d/status.json"), Port));
	Request->SetVerb(TEXT("GET"));
	Request->SetTimeout(1.0f);
	TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
	Request->OnProcessRequestComplete().BindLambda([Weak, Port](FHttpRequestPtr Req, FHttpResponsePtr Response, bool bConnected)
	{
		bool bRelay = false;
		if (bConnected && Response.IsValid() && Response->GetResponseCode() == 200)
		{
			TSharedPtr<FJsonObject> Status;
			TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Response->GetContentAsString());
			FString Relay;
			bRelay = FJsonSerializer::Deserialize(Reader, Status) && Status.IsValid() && Status->TryGetStringField(TEXT("relay"), Relay);
		}
		if (Weak.IsValid())
		{
			Weak->FinishRelayCheck(Req.Get(), bRelay, Port);
		}
	});
	RelayCheck = Request;
	UE_LOG(LogPhoneWand, Verbose, TEXT("Checking for a relay at http://127.0.0.1:%d/status.json"), Port);
	if (!Request->ProcessRequest() && RelayCheck.Get() == &Request.Get())
	{
		RelayCheck.Reset();
		LaunchRelay(Port);
		return false;
	}
	return true;
#endif
}

void UPhoneWandSubsystem::FinishRelayCheck(const IHttpRequest* Request, bool bRelayAnswered, int32 Port)
{
	if (!IsInGameThread())
	{
		TWeakObjectPtr<UPhoneWandSubsystem> Weak(this);
		AsyncTask(ENamedThreads::GameThread, [Weak, Request, bRelayAnswered, Port]() { if (Weak.IsValid()) { Weak->FinishRelayCheck(Request, bRelayAnswered, Port); } });
		return;
	}
	if (!RelayCheck.IsValid() || RelayCheck.Get() != Request)
	{
		return; // cancelled, or replaced by a newer check
	}
	RelayCheck.Reset();
	if (bClosedByUser)
	{
		return;
	}
	if (bRelayAnswered)
	{
		UE_LOG(LogPhoneWand, Log, TEXT("A relay is already running on port %d; using it."), Port);
	}
	else
	{
		LaunchRelay(Port);
	}
	OpenSocket();
}

void UPhoneWandSubsystem::CancelRelayCheck()
{
	if (RelayCheck.IsValid())
	{
		TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> Old = MoveTemp(RelayCheck);
		RelayCheck.Reset();
		Old->OnProcessRequestComplete().Unbind();
		Old->CancelRequest();
	}
}

void UPhoneWandSubsystem::LaunchRelay(int32 Port)
{
#if PHONEWAND_CAN_START_RELAY
	const FString Exe = ResolveRelayExecutable(RelayPathSetting);
	if (Exe.IsEmpty() || !FPaths::FileExists(Exe))
	{
		UE_LOG(LogPhoneWand, Warning, TEXT("Start Relay is on, but there is no relay program at %s. Put the phone-wand-relay folder in the plugin's Resources/Relay folder or set Relay Path (see docs/shipping.md). Connecting as usual."),
			Exe.IsEmpty() ? *FString::Printf(TEXT("%s (no relay build for this platform)"), *RelayPathSetting) : *Exe);
		return;
	}

#if PLATFORM_MAC || PLATFORM_LINUX
	{
		// Make sure it is executable: copying or unzipping can lose the flag. A read-only
		// location may refuse; the file may be executable already, so carry on.
		const FTCHARToUTF8 Utf8(*Exe);
		struct stat Info;
		if (stat(Utf8.Get(), &Info) == 0 && (Info.st_mode & 0111) != 0111)
		{
			chmod(Utf8.Get(), Info.st_mode | 0755);
		}
	}
#endif

	const FString LogDir = FPaths::ConvertRelativePathToFull(FPaths::ProjectLogDir());
	IFileManager::Get().MakeDirectory(*LogDir, true);
	const FString LogFile = FPaths::Combine(LogDir, TEXT("phone-wand-relay.log"));
	FString Params = FString::Printf(TEXT("--lifeline --no-open --app-port %d --log \"%s\""), Port, *LogFile);
	const FString Extra = RelayArgumentsSetting.TrimStartAndEnd();
	if (!Extra.IsEmpty())
	{
		Params += TEXT(" ");
		Params += Extra;
	}

	// The relay's standard input is a pipe whose write end only this process holds. Closing it
	// (or this process ending, however it ends) tells the relay to stop (--lifeline).
	void* ChildStdin = nullptr;
	void* OurEnd = nullptr;
	if (!FPlatformProcess::CreatePipe(ChildStdin, OurEnd, /*bWritePipeLocal*/ true))
	{
		UE_LOG(LogPhoneWand, Warning, TEXT("Could not create a pipe for the relay; not starting it. Connecting as usual."));
		return;
	}
	uint32 ProcessId = 0;
	FProcHandle Proc = FPlatformProcess::CreateProc(*Exe, *Params,
		/*bLaunchDetached*/ true, /*bLaunchHidden*/ true, /*bLaunchReallyHidden*/ true,
		&ProcessId, /*PriorityModifier*/ 0, /*OptionalWorkingDirectory*/ nullptr,
		/*PipeWriteChild (stdout)*/ nullptr, /*PipeReadChild (stdin)*/ ChildStdin);
	FPlatformProcess::ClosePipe(ChildStdin, nullptr); // the child has its own copy
	if (!Proc.IsValid())
	{
		FPlatformProcess::ClosePipe(nullptr, OurEnd);
		UE_LOG(LogPhoneWand, Warning, TEXT("Could not start the relay at %s. Connecting as usual."), *Exe);
		return;
	}
	RelayProc = Proc;
	RelayStdinWrite = OurEnd;
	RelayPort = Port;
	RelayProcessId = ProcessId;
	UE_LOG(LogPhoneWand, Log, TEXT("Started the relay (process %u) for app port %d: %s %s"), ProcessId, Port, *Exe, *Params);
	UE_LOG(LogPhoneWand, Log, TEXT("The relay logs to %s"), *LogFile);
#endif
}

void UPhoneWandSubsystem::StopRelay()
{
	if (RelayStdinWrite != nullptr)
	{
		FPlatformProcess::ClosePipe(nullptr, RelayStdinWrite);
		RelayStdinWrite = nullptr;
	}
	if (!RelayProc.IsValid())
	{
		return;
	}
	const double Deadline = FPlatformTime::Seconds() + 2.0;
	while (FPlatformProcess::IsProcRunning(RelayProc) && FPlatformTime::Seconds() < Deadline)
	{
		FPlatformProcess::Sleep(0.02f);
	}
	if (FPlatformProcess::IsProcRunning(RelayProc))
	{
		UE_LOG(LogPhoneWand, Warning, TEXT("The relay did not stop within two seconds of its standard input closing; ending it."));
		FPlatformProcess::TerminateProc(RelayProc, /*KillTree*/ true);
		const double KillDeadline = FPlatformTime::Seconds() + 1.0;
		while (FPlatformProcess::IsProcRunning(RelayProc) && FPlatformTime::Seconds() < KillDeadline)
		{
			FPlatformProcess::Sleep(0.02f);
		}
	}
	else
	{
		UE_LOG(LogPhoneWand, Log, TEXT("Stopped the relay."));
	}
	FPlatformProcess::CloseProc(RelayProc);
	RelayProc.Reset();
	RelayPort = 0;
	RelayProcessId = 0;
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

bool UPhoneWandSubsystem::GetControlValue(const FString& Id, const FString& ControlId, FPhoneWandControlValue& Value) const
{
	Value = FPhoneWandControlValue();
	const FPhoneWandPlayer* P = Players.Find(Id);
	const FPhoneWandControlValue* V = P ? P->Controls.Find(ControlId) : nullptr;
	if (!V)
	{
		return false;
	}
	Value = *V;
	return true;
}

// ---------------------------------------------------------------------- app to relay

void UPhoneWandSubsystem::SendJson(const TSharedRef<FJsonObject>& Msg)
{
	if (SendOverride)
	{
		SendOverride(ToJsonString(Msg));
		return;
	}
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

// ---------------------------------------------------------------------- layouts

void UPhoneWandSubsystem::SetLayout(const FPhoneWandLayout& Layout, const FString& Id)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("layout"));
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	Msg->SetObjectField(TEXT("layout"), PhoneWand::LayoutToJson(Layout));
	SendJson(Msg);
}

void UPhoneWandSubsystem::ResetLayout(const FString& Id)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("layout"));
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	Msg->SetField(TEXT("layout"), MakeShared<FJsonValueNull>());
	SendJson(Msg);
}

void UPhoneWandSubsystem::SetControl(const FString& ControlId, const FPhoneWandControlValue& Value, const FString& Id)
{
	TSharedRef<FJsonObject> Msg = MakeShared<FJsonObject>();
	Msg->SetStringField(TEXT("type"), TEXT("set"));
	if (!Id.IsEmpty())
	{
		Msg->SetStringField(TEXT("id"), Id);
	}
	Msg->SetStringField(TEXT("control"), ControlId);
	Msg->SetField(TEXT("value"), PhoneWand::ControlValueToJson(Value));
	SendJson(Msg);
}

void UPhoneWandSubsystem::SetControlBool(const FString& ControlId, bool bValue, const FString& Id)
{
	SetControl(ControlId, FPhoneWandControlValue::MakeBool(bValue), Id);
}

void UPhoneWandSubsystem::SetControlNumber(const FString& ControlId, double Value, const FString& Id)
{
	SetControl(ControlId, FPhoneWandControlValue::MakeNumber(Value), Id);
}

void UPhoneWandSubsystem::SetControlChoice(const FString& ControlId, int32 Index, const FString& Id)
{
	SetControl(ControlId, FPhoneWandControlValue::MakeNumber(Index), Id);
}

void UPhoneWandSubsystem::SetControlText(const FString& ControlId, const FString& Text, const FString& Id)
{
	SetControl(ControlId, FPhoneWandControlValue::MakeText(Text), Id);
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
	FPhoneWandPlayer* Existing = Players.Find(Id);
	FPhoneWandPlayer& P = Existing ? *Existing : Players.Add(Id);
	if (!Existing)
	{
		// What a relay that predates layouts means: the default layout.
		P.Layout = PhoneWand::DefaultLayout();
	}
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
	// The layout and control values, when present, replace the old ones entirely.
	if (const TSharedPtr<FJsonValue> Layout = Info.TryGetField(TEXT("layout")))
	{
		const TSharedPtr<FJsonObject>* LayoutObj = nullptr;
		P.Layout = Layout->TryGetObject(LayoutObj) && LayoutObj != nullptr && LayoutObj->IsValid()
			? PhoneWand::LayoutFromJson(**LayoutObj) : PhoneWand::DefaultLayout();
	}
	const TSharedPtr<FJsonObject>* Controls = nullptr;
	if (Info.TryGetObjectField(TEXT("controls"), Controls) && Controls != nullptr && Controls->IsValid())
	{
		P.Controls.Reset();
		for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : (*Controls)->Values)
		{
			P.Controls.Add(Pair.Key, PhoneWand::ControlValueFromJson(Pair.Value));
		}
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
	else if (Type == TEXT("control"))
	{
		FPhoneWandPlayer* Live = FindById();
		if (!Live)
		{
			return;
		}
		FString ControlId;
		Msg.TryGetStringField(TEXT("control"), ControlId);
		const FPhoneWandControlValue Value = PhoneWand::ControlValueFromJson(Msg.TryGetField(TEXT("value")));
		Live->Controls.Add(ControlId, Value);
		const FPhoneWandPlayer P = *Live;
		OnControlChanged.Broadcast(P, ControlId, Value);
		OnControlChangedNative.Broadcast(P, ControlId, Value);
	}
	else if (Type == TEXT("error"))
	{
		FString Message;
		Msg.TryGetStringField(TEXT("message"), Message);
		if (OnRelayError.IsBound() || OnRelayErrorNative.IsBound())
		{
			OnRelayError.Broadcast(Message);
			OnRelayErrorNative.Broadcast(Message);
		}
		else
		{
			UE_LOG(LogPhoneWand, Warning, TEXT("The relay says: %s"), *Message);
		}
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
