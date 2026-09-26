// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandDemoHUD.h"

#include "CanvasTypes.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "Engine/GameInstance.h"
#include "Engine/Texture2D.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "HttpModule.h"
#include "ImageUtils.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "PhoneWandLibrary.h"
#include "PhoneWandSubsystem.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "UnrealClient.h"

namespace
{
	constexpr float CursorRadius = 14.0f;
	constexpr double RippleSeconds = 0.6;
	constexpr float EdgeMargin = 36.0f;
	const FLinearColor Panel(0.0f, 0.0f, 0.0f, 0.55f);
	constexpr double LastChangeSeconds = 2.5;

	// The sample layouts L cycles through. Index 0 is the default (Primary and Secondary).
	constexpr int32 SampleLayoutCount = 3;

	FString SampleLayoutName(int32 Index)
	{
		switch (Index)
		{
		case 1: return TEXT("primary-row: Fire, Zoom toggle, label");
		case 2: return TEXT("grid: every kind of control");
		default: return TEXT("default: Primary and Secondary");
		}
	}

	FPhoneWandLayout SampleLayout(int32 Index)
	{
		if (Index == 1)
		{
			return UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::PrimaryRow, {
				UPhoneWandLibrary::MakeButton(TEXT("fire"), TEXT("Fire")),
				UPhoneWandLibrary::MakeToggle(TEXT("zoom"), TEXT("Zoom")),
				UPhoneWandLibrary::MakeLabel(TEXT("info"), TEXT("Layout"), TEXT("primary-row")),
			});
		}
		return UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::Grid, {
			UPhoneWandLibrary::MakeButton(TEXT("fire"), TEXT("Fire")),
			UPhoneWandLibrary::MakeToggle(TEXT("shield"), TEXT("Shield")),
			UPhoneWandLibrary::MakeSlider(TEXT("power"), TEXT("Power"), 0.25),
			UPhoneWandLibrary::MakeSlider(TEXT("throttle"), TEXT("Throttle"), 0.5, /*bVertical*/ true, /*bSpring*/ true, 0.5),
			UPhoneWandLibrary::MakeChoice(TEXT("weapon"), { TEXT("Bow"), TEXT("Sling"), TEXT("Net") }, TEXT("Weapon"), 0),
			UPhoneWandLibrary::MakeLabel(TEXT("score"), TEXT("Score"), TEXT("0")),
		});
	}

	// True for a player who still has to do something before they get a cursor.
	bool IsWaiting(const FPhoneWandPlayer& Player)
	{
		return Player.State == EPhoneWandPlayerState::Waiting || Player.Calibration == EPhoneWandCalibration::None
			|| Player.Calibrating != EPhoneWandCalibrationStep::None;
	}
}

void APhoneWandDemoHUD::BeginPlay()
{
	Super::BeginPlay();

	if (FParse::Value(FCommandLine::Get(), TEXT("PhoneWandDemoShot="), ShotFile) && !ShotFile.IsEmpty())
	{
		double Delay = 5.0;
		FParse::Value(FCommandLine::Get(), TEXT("PhoneWandDemoShotDelay="), Delay);
		ShotAt = FPlatformTime::Seconds() + Delay;
	}

	UGameInstance* GameInstance = GetGameInstance();
	UPhoneWandSubsystem* Subsystem = GameInstance ? GameInstance->GetSubsystem<UPhoneWandSubsystem>() : nullptr;
	if (!Subsystem)
	{
		return;
	}
	Wand = Subsystem;
	ConnectedHandle = Subsystem->OnConnectedNative.AddUObject(this, &APhoneWandDemoHUD::OnConnected);
	ButtonHandle = Subsystem->OnButtonNative.AddUObject(this, &APhoneWandDemoHUD::OnButton);
	ControlHandle = Subsystem->OnControlChangedNative.AddUObject(this, &APhoneWandDemoHUD::OnControlChanged);
	ErrorHandle = Subsystem->OnRelayErrorNative.AddUObject(this, &APhoneWandDemoHUD::OnRelayError);
	if (Subsystem->IsConnected())
	{
		OnConnected(Subsystem->GetHello());
	}
}

void APhoneWandDemoHUD::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UPhoneWandSubsystem* Subsystem = Wand.Get())
	{
		Subsystem->OnConnectedNative.Remove(ConnectedHandle);
		Subsystem->OnButtonNative.Remove(ButtonHandle);
		Subsystem->OnControlChangedNative.Remove(ControlHandle);
		Subsystem->OnRelayErrorNative.Remove(ErrorHandle);
	}
	Super::EndPlay(EndPlayReason);
}

void APhoneWandDemoHUD::OnConnected(const FPhoneWandHello& Hello)
{
	if (!Hello.QrUrl.IsEmpty() && Hello.QrUrl != QrForUrl)
	{
		FetchQrCode(Hello.QrUrl);
	}
}

void APhoneWandDemoHUD::OnButton(const FPhoneWandPlayer& Player, const FString& Button, bool bDown)
{
	// Any button: "primary" by default, or "fire" in the sample layouts.
	if (bDown && Player.bHasPose && Player.Pose.bHasScreen)
	{
		Ripples.Add({ Player.Pose.Screen, Player.LinearColour, FPlatformTime::Seconds() });
	}
}

void APhoneWandDemoHUD::OnControlChanged(const FPhoneWandPlayer& Player, const FString& ControlId, const FPhoneWandControlValue& Value)
{
	FString Shown = Value.ToString();
	if (Value.Type == EPhoneWandValueType::Number)
	{
		// A choice shows its option's name; a slider two decimals.
		const FPhoneWandControl* Control = Player.Layout.FindControl(ControlId);
		Shown = Control && Control->Type == EPhoneWandControlType::Choice && Control->Options.IsValidIndex(Value.Index)
			? Control->Options[Value.Index] : FString::Printf(TEXT("%.2f"), Value.Number);
	}
	LastChange = FString::Printf(TEXT("%s: %s = %s"), *Player.Name, *ControlId, *Shown);
	LastChangeColour = Player.LinearColour;
	LastChangeAt = FPlatformTime::Seconds();
}

void APhoneWandDemoHUD::OnRelayError(const FString& Message)
{
	LastChange = TEXT("Relay: ") + Message;
	LastChangeColour = FLinearColor::Red;
	LastChangeAt = FPlatformTime::Seconds();
}

void APhoneWandDemoHUD::UpdateLayoutKey(UPhoneWandSubsystem* Subsystem)
{
	APlayerController* PC = GetOwningPlayerController();
	if (!Subsystem || !PC || !PC->WasInputKeyJustPressed(EKeys::L))
	{
		return;
	}
	LayoutIndex = (LayoutIndex + 1) % SampleLayoutCount;
	if (LayoutIndex == 0)
	{
		Subsystem->ResetLayout();
	}
	else
	{
		Subsystem->SetLayout(SampleLayout(LayoutIndex));
	}
}

void APhoneWandDemoHUD::DrawLastChange()
{
	const double Age = FPlatformTime::Seconds() - LastChangeAt;
	if (LastChange.IsEmpty() || Age > LastChangeSeconds)
	{
		return;
	}
	UFont* Font = GEngine ? GEngine->GetMediumFont() : nullptr;
	const float Scale = 1.3f;
	float W = 0.0f, H = 0.0f;
	GetTextSize(LastChange, W, H, Font, Scale);
	DrawLabel(LastChange, FVector2D((Canvas->SizeX - W) * 0.5f, 24.0f), LastChangeColour, Scale);
}

void APhoneWandDemoHUD::FetchQrCode(const FString& Url)
{
	QrForUrl = Url;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(Url + TEXT("?size=320"));
	Request->SetVerb(TEXT("GET"));
	TWeakObjectPtr<APhoneWandDemoHUD> Weak(this);
	Request->OnProcessRequestComplete().BindLambda([Weak](FHttpRequestPtr, FHttpResponsePtr Response, bool bOk)
	{
		if (!Weak.IsValid() || !bOk || !Response.IsValid() || Response->GetResponseCode() != 200)
		{
			return;
		}
		Weak->QrTexture = FImageUtils::ImportBufferAsTexture2D(Response->GetContent());
	});
	Request->ProcessRequest();
}

void APhoneWandDemoHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}
	UpdateAutoScreenshot();
	UPhoneWandSubsystem* Subsystem = Wand.Get();
	UpdateLayoutKey(Subsystem);
	DrawStatus(Subsystem);
	DrawRipples();
	DrawLastChange();
	if (!Subsystem)
	{
		return;
	}
	const TArray<FPhoneWandPlayer> Players = Subsystem->GetPlayers();
	for (const FPhoneWandPlayer& Player : Players)
	{
		DrawCursor(Player);
	}
	DrawWaiting(Players);
}

void APhoneWandDemoHUD::DrawLabel(const FString& Text, FVector2D Position, FLinearColor Colour, float Scale)
{
	UFont* Font = GEngine ? GEngine->GetMediumFont() : nullptr;
	float W = 0.0f, H = 0.0f;
	GetTextSize(Text, W, H, Font, Scale);
	DrawRect(Panel, Position.X - 4.0f, Position.Y - 2.0f, W + 8.0f, H + 4.0f);
	DrawText(Text, Colour, Position.X, Position.Y, Font, Scale);
}

void APhoneWandDemoHUD::DrawStatus(UPhoneWandSubsystem* Subsystem)
{
	const float W = Canvas->SizeX;
	const float H = Canvas->SizeY;
	FVector2D At(24.0f, 20.0f);

	DrawLabel(TEXT("Phone Wand demo"), At, FLinearColor::White, 1.4f);
	At.Y += 32.0f;
	if (!Subsystem)
	{
		DrawLabel(TEXT("The Phone Wand plugin is not loaded."), At, FLinearColor::Red);
		return;
	}
	if (!Subsystem->IsConnected())
	{
		DrawLabel(FString::Printf(TEXT("Waiting for the relay at %s ..."), *Subsystem->GetUrl()), At, FLinearColor::Yellow);
		At.Y += 24.0f;
		DrawLabel(TEXT("Start the relay: phone-wand   (or phone-wand --simulate 3 to try it without phones)"), At, FLinearColor(0.8f, 0.8f, 0.8f));
		return;
	}

	const FPhoneWandHello Hello = Subsystem->GetHello();
	DrawLabel(FString::Printf(TEXT("Join: %s"), *Hello.JoinUrl), At, FLinearColor::White);
	At.Y += 24.0f;
	DrawLabel(FString::Printf(TEXT("%d of %d players"), Subsystem->GetPlayerCount(), Hello.MaxPlayers), At, FLinearColor(0.8f, 0.8f, 0.8f));
	At.Y += 24.0f;
	DrawLabel(FString::Printf(TEXT("L: phone layout (%s)"), *SampleLayoutName(LayoutIndex)), At, FLinearColor(0.8f, 0.8f, 0.8f));

	// Player list, bottom left.
	const TArray<FPhoneWandPlayer> Players = Subsystem->GetPlayers();
	FVector2D Row(24.0f, H - 24.0f - 24.0f * Players.Num());
	for (const FPhoneWandPlayer& P : Players)
	{
		FString Line = FString::Printf(TEXT("%d  %s  %s  %s"), P.Slot + 1, *P.Name,
			*PhoneWand::ToString(P.State), *PhoneWand::ToString(P.Calibration));
		if (P.bHasStats)
		{
			Line += FString::Printf(TEXT("  %.0f ms  %.0f Hz"), P.Stats.Rtt, P.Stats.Rate);
		}
		if (P.Buttons.Num() > 0)
		{
			Line += TEXT("  [") + FString::Join(P.Buttons, TEXT(", ")) + TEXT("]");
		}
		DrawLabel(Line, Row, P.LinearColour);
		Row.Y += 24.0f;
	}

	// Join QR code, top right. Smaller once people are playing.
	if (QrTexture)
	{
		const float Size = Players.Num() == 0 ? FMath::Min(320.0f, H * 0.4f) : 128.0f;
		const float X = W - Size - 24.0f;
		DrawRect(FLinearColor::White, X - 6.0f, 18.0f, Size + 12.0f, Size + 12.0f);
		DrawTexture(QrTexture, X, 24.0f, Size, Size, 0.0f, 0.0f, 1.0f, 1.0f, FLinearColor::White, BLEND_Opaque);
	}
}

void APhoneWandDemoHUD::DrawCursor(const FPhoneWandPlayer& Player)
{
	if (!Player.bHasPose)
	{
		return;
	}
	const FVector2D Size(Canvas->SizeX, Canvas->SizeY);
	const FPhoneWandPose& Pose = Player.Pose;
	if (!Pose.bHasScreen && IsWaiting(Player))
	{
		// No cursor until the player has aimed once, nor while they calibrate: DrawWaiting says why.
		return;
	}
	const bool bPaused = Player.State != EPhoneWandPlayerState::Active;
	FLinearColor Colour = Player.LinearColour;
	if (bPaused)
	{
		Colour.A = 0.4f;
	}

	if (!UPhoneWandLibrary::IsOnScreen(Pose))
	{
		// Off the screen, or pointing so far away there is no screen position: aim an arrow at where
		// they are pointing, using yaw and pitch when there is no screen position at all.
		const FVector2D Target = Pose.bHasScreen
			? UPhoneWandLibrary::ScreenToPixels(Pose.Screen, Size)
			: Size * 0.5 + FVector2D(FMath::Sin(FMath::DegreesToRadians(Pose.Yaw)), -FMath::Sin(FMath::DegreesToRadians(Pose.Pitch))) * Size.GetMax() * 4.0;
		DrawEdgeArrow(Player, Target);
		return;
	}

	const FVector2D At = UPhoneWandLibrary::ScreenToPixels(Pose.Screen, Size);
	Canvas->K2_DrawPolygon(nullptr, At, FVector2D(CursorRadius + 3.0f), 32, FLinearColor(0.0f, 0.0f, 0.0f, Colour.A));
	Canvas->K2_DrawPolygon(nullptr, At, FVector2D(CursorRadius), 32, Colour);
	if (Player.Buttons.Num() > 0)
	{
		DrawRing(At, CursorRadius + 8.0f, Colour, 3.0f);
	}
	FString Name = Player.Name;
	if (!Player.Label.IsEmpty())
	{
		Name += TEXT(" (") + Player.Label + TEXT(")");
	}
	if (bPaused)
	{
		Name += TEXT(" - paused");
	}
	DrawLabel(Name, At + FVector2D(CursorRadius + 8.0f, -10.0f), Colour);
}

void APhoneWandDemoHUD::DrawWaiting(const TArray<FPhoneWandPlayer>& Players)
{
	TArray<const FPhoneWandPlayer*> Waiting;
	for (const FPhoneWandPlayer& P : Players)
	{
		if (IsWaiting(P))
		{
			Waiting.Add(&P);
		}
	}
	if (Waiting.Num() == 0)
	{
		return;
	}
	// Stacked upwards from just above the player list, one line per player in slot order.
	UFont* Font = GEngine ? GEngine->GetMediumFont() : nullptr;
	const float Scale = 1.2f;
	float TextW = 0.0f, TextH = 0.0f;
	GetTextSize(TEXT("Player"), TextW, TextH, Font, Scale);
	const float LineHeight = TextH * 1.5f;
	const float Bottom = Canvas->SizeY - 24.0f - 24.0f * Players.Num() - 12.0f;
	const float Left = 24.0f;
	for (int32 i = 0; i < Waiting.Num(); ++i)
	{
		const FPhoneWandPlayer& P = *Waiting[i];
		const TCHAR* What = P.Calibrating != EPhoneWandCalibrationStep::None ? TEXT("is calibrating: aim at the marked corner")
			: P.State == EPhoneWandPlayerState::Waiting ? TEXT("tap Tap to start on your phone")
			: TEXT("set up your aim on your phone");
		const FString Numbered = FString::Printf(TEXT("Player %d"), P.Slot + 1);
		const FString Who = P.Name == Numbered ? P.Name : Numbered + TEXT(", ") + P.Name;
		const float Top = Bottom - (Waiting.Num() - i) * LineHeight;
		const float Dot = TextH * 0.35f;
		Canvas->K2_DrawPolygon(nullptr, FVector2D(Left + Dot, Top + TextH * 0.5f), FVector2D(Dot), 24, P.LinearColour);
		DrawLabel(Who + TEXT(": ") + What, FVector2D(Left + TextH * 1.2f, Top), P.LinearColour, Scale);
	}
}

void APhoneWandDemoHUD::DrawEdgeArrow(const FPhoneWandPlayer& Player, FVector2D Target)
{
	const FVector2D Size(Canvas->SizeX, Canvas->SizeY);
	const FVector2D Centre = Size * 0.5;
	FVector2D Dir = Target - Centre;
	if (Dir.IsNearlyZero())
	{
		return;
	}
	Dir.Normalize();

	// Where the ray from the centre towards the target leaves the inset screen rectangle.
	const FVector2D Half = Centre - FVector2D(EdgeMargin);
	const double TX = FMath::Abs(Dir.X) > KINDA_SMALL_NUMBER ? Half.X / FMath::Abs(Dir.X) : DBL_MAX;
	const double TY = FMath::Abs(Dir.Y) > KINDA_SMALL_NUMBER ? Half.Y / FMath::Abs(Dir.Y) : DBL_MAX;
	const FVector2D Tip = Centre + Dir * FMath::Min(TX, TY);

	const FVector2D Side(-Dir.Y, Dir.X);
	const FVector2D Base = Tip - Dir * 34.0;
	FLinearColor Colour = Player.LinearColour;
	if (Player.State != EPhoneWandPlayerState::Active)
	{
		Colour.A = 0.4f;
	}

	FCanvasUVTri Tri;
	Tri.V0_Pos = Tip;
	Tri.V1_Pos = Base + Side * 11.0;
	Tri.V2_Pos = Base - Side * 11.0;
	Tri.V0_Color = Tri.V1_Color = Tri.V2_Color = Colour;
	Canvas->K2_DrawTriangle(nullptr, { Tri });

	// Name just inside the arrow, pushed far enough along the arrow that the box does not cover it.
	UFont* Font = GEngine ? GEngine->GetMediumFont() : nullptr;
	float W = 0.0f, H = 0.0f;
	GetTextSize(Player.Name, W, H, Font);
	const double Extent = FMath::Abs(Dir.X) * (W * 0.5 + 4.0) + FMath::Abs(Dir.Y) * (H * 0.5 + 2.0);
	FVector2D Label = Base - Dir * (Extent + 8.0) - FVector2D(W * 0.5, H * 0.5);
	Label.X = FMath::Clamp(Label.X, 8.0, Size.X - W - 8.0);
	Label.Y = FMath::Clamp(Label.Y, 8.0, Size.Y - H - 8.0);
	DrawLabel(Player.Name, Label, Colour);
}

void APhoneWandDemoHUD::DrawRipples()
{
	const double Now = FPlatformTime::Seconds();
	Ripples.RemoveAll([Now](const FRipple& R) { return Now - R.Start > RippleSeconds; });
	const FVector2D Size(Canvas->SizeX, Canvas->SizeY);
	for (const FRipple& R : Ripples)
	{
		const float T = float((Now - R.Start) / RippleSeconds);
		FLinearColor Colour = R.Colour;
		Colour.A = 1.0f - T;
		DrawRing(UPhoneWandLibrary::ScreenToPixels(R.Screen, Size), CursorRadius + 70.0f * T, Colour, 4.0f * (1.0f - T) + 1.0f);
	}
}

void APhoneWandDemoHUD::DrawRing(FVector2D Centre, float Radius, FLinearColor Colour, float Thickness)
{
	constexpr int32 Segments = 40;
	FVector2D Prev = Centre + FVector2D(Radius, 0.0f);
	for (int32 i = 1; i <= Segments; ++i)
	{
		const float A = 2.0f * PI * i / Segments;
		const FVector2D Next = Centre + FVector2D(FMath::Cos(A), FMath::Sin(A)) * Radius;
		DrawLine(Prev.X, Prev.Y, Next.X, Next.Y, Colour, Thickness);
		Prev = Next;
	}
}

void APhoneWandDemoHUD::UpdateAutoScreenshot()
{
	if (ShotFile.IsEmpty())
	{
		return;
	}
	const double Now = FPlatformTime::Seconds();
	if (!bShotTaken && Now >= ShotAt)
	{
		bShotTaken = true;
		FScreenshotRequest::RequestScreenshot(ShotFile, /*bInShowUI*/ true, /*bAddFilenameSuffix*/ false);
	}
	else if (bShotTaken && Now >= ShotAt + 2.0)
	{
		ShotFile.Empty();
		FPlatformMisc::RequestExit(false);
	}
}
