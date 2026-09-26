// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// The Phone Wand client: connects to the relay and tracks every player's pose and buttons.
//
//   UPhoneWandSubsystem* Wand = GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>();
//   Wand->OnPoseNative.AddLambda([](const FPhoneWandPlayer& Player, const FPhoneWandPose& Pose) { ... });
//
// Every event fires on the game thread.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Containers/Ticker.h"
#include "HAL/PlatformProcess.h"
#include "PhoneWandTypes.h"
#include "PhoneWandSubsystem.generated.h"

class IWebSocket;
class FJsonObject;
class IHttpRequest;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhoneWandConnectedEvent, const FPhoneWandHello&, Hello);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FPhoneWandDisconnectedEvent);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhoneWandPlayerEvent, const FPhoneWandPlayer&, Player);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandPoseEvent, const FPhoneWandPlayer&, Player, const FPhoneWandPose&, Pose);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FPhoneWandButtonEvent, const FPhoneWandPlayer&, Player, const FString&, Button, bool, bDown);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratingEvent, const FPhoneWandPlayer&, Player, EPhoneWandCalibrationStep, Step);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratedEvent, const FPhoneWandPlayer&, Player, EPhoneWandCalibration, Calibration);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandStatsEvent, const FPhoneWandPlayer&, Player, const FPhoneWandStats&, Stats);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FPhoneWandControlEvent, const FPhoneWandPlayer&, Player, const FString&, ControlId, const FPhoneWandControlValue&, Value);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhoneWandErrorEvent, const FString&, Message);

DECLARE_MULTICAST_DELEGATE_OneParam(FPhoneWandConnectedNative, const FPhoneWandHello&);
DECLARE_MULTICAST_DELEGATE(FPhoneWandDisconnectedNative);
DECLARE_MULTICAST_DELEGATE_OneParam(FPhoneWandPlayerNative, const FPhoneWandPlayer&);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandPoseNative, const FPhoneWandPlayer&, const FPhoneWandPose&);
DECLARE_MULTICAST_DELEGATE_ThreeParams(FPhoneWandButtonNative, const FPhoneWandPlayer&, const FString&, bool);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratingNative, const FPhoneWandPlayer&, EPhoneWandCalibrationStep);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratedNative, const FPhoneWandPlayer&, EPhoneWandCalibration);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandStatsNative, const FPhoneWandPlayer&, const FPhoneWandStats&);
DECLARE_MULTICAST_DELEGATE_ThreeParams(FPhoneWandControlNative, const FPhoneWandPlayer&, const FString&, const FPhoneWandControlValue&);
DECLARE_MULTICAST_DELEGATE_OneParam(FPhoneWandErrorNative, const FString&);

/**
 * Phone Wand client. One per game instance; get it with Get Game Instance Subsystem (Blueprint)
 * or GetGameInstance()->GetSubsystem<UPhoneWandSubsystem>() (C++).
 *
 * Each event exists twice: a Blueprint-assignable delegate (OnPose) and a native C++ one
 * (OnPoseNative) that takes lambdas. Both fire, in that order, on the game thread.
 */
UCLASS()
class PHONEWAND_API UPhoneWandSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	// ------------------------------------------------------------------ lifecycle

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void BeginDestroy() override;

	// ------------------------------------------------------------------ connection

	/**
	 * Connect to the relay. An empty Url uses the project setting (default ws://127.0.0.1:8480/app).
	 * Keeps retrying with backoff until Disconnect when auto reconnect is on.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand")
	void Connect(const FString& Url = TEXT(""));

	/** Close the connection and stop reconnecting. Fires OnPlayerLeft for every player, then OnDisconnected. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand")
	void Disconnect();

	/** True once the relay has said hello. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	bool IsConnected() const { return bHasHello; }

	/** The relay's hello (join URL, QR code URL, max players). Only meaningful while connected. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	FPhoneWandHello GetHello() const { return Hello; }

	/** The URL this client connects (or last connected) to. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	FString GetUrl() const { return CurrentUrl; }

	/** Reconnect automatically when the relay goes away. Defaults to the project setting. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand")
	void SetAutoReconnect(bool bEnabled) { bAutoReconnect = bEnabled; }

	// ------------------------------------------------------------------ managed relay

	/**
	 * Start the relay from the game (see docs/shipping.md). Takes effect on the next Connect.
	 * Defaults to the project settings (Start Relay, Relay Path, Relay Arguments). An empty
	 * RelayPath uses <plugin>/Resources/Relay/phone-wand-relay; it may also name the executable.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Relay")
	void SetStartRelay(bool bEnabled, const FString& RelayPath = TEXT(""), const FString& RelayArguments = TEXT(""));

	/** True while a relay that this subsystem started is running. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Relay")
	bool IsRelayStartedByPlugin() const;

	/**
	 * Stop the relay this subsystem started, if any: closes its standard input, waits up to two
	 * seconds, then ends it. A relay the plugin did not start is never stopped. Called for you by
	 * Disconnect and when the game instance shuts down.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Relay")
	void StopRelay();

	/** C++: the process id of the relay this subsystem started, or 0. */
	uint32 GetRelayProcessId() const { return IsRelayStartedByPlugin() ? RelayProcessId : 0; }

	/** The relay's folder name for this platform (macos, windows-x64, linux-x64, linux-arm64), or empty. */
	static FString GetRelayPlatform();

	/**
	 * The relay executable a path setting points at: the path itself when it is a file, otherwise
	 * <path>/<platform>/phone-wand-relay (.exe on Windows). Empty uses the plugin's Resources/Relay.
	 */
	static FString ResolveRelayExecutable(const FString& RelayPath);

	/** True when Url's host is 127.0.0.1, localhost or [::1]; OutPort gets its port (8480 if none). */
	static bool ParseLocalRelayUrl(const FString& Url, int32& OutPort);

	// ------------------------------------------------------------------ players

	/** All players, sorted by slot. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	TArray<FPhoneWandPlayer> GetPlayers() const;

	/** One player by id. Returns false when there is no such player. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand")
	bool GetPlayer(const FString& Id, FPhoneWandPlayer& Player) const;

	/** The player in a slot. Returns false when the slot is empty. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand")
	bool GetPlayerInSlot(int32 Slot, FPhoneWandPlayer& Player) const;

	/** Number of players. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	int32 GetPlayerCount() const { return Players.Num(); }

	/** True while the player holds the button: "primary" or "secondary" by default, or a button id from your layout. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	bool IsButtonHeld(const FString& Id, const FString& Button = TEXT("primary")) const;

	/**
	 * A control's current value for a player (a toggle, slider, choice or label in their layout).
	 * Returns false when there is no such player or control.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	bool GetControlValue(const FString& Id, const FString& ControlId, FPhoneWandControlValue& Value) const;

	/** Direct access for C++: the player by id, or null. Valid until the next event. */
	const FPhoneWandPlayer* FindPlayer(const FString& Id) const { return Players.Find(Id); }

	// ------------------------------------------------------------------ app to relay

	/** Set the One Euro filter the relay applies to this app's poses. Remembered across reconnects. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void SetSmoothing(float MinCutoff = 1.0f, float Beta = 5.0f, float DCutoff = 1.0f);

	/** Turn smoothing off: poses are raw sensor data. Remembered across reconnects. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void SetRaw();

	/** Change a player's colour ("#rrggbb") and/or label. Leave a field empty to keep it. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands", meta = (AdvancedDisplay = "Label"))
	void Style(const FString& Id, const FString& Colour, const FString& Label = TEXT(""));

	/** Change a player's colour from a linear colour. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void StyleColour(const FString& Id, FLinearColor Colour);

	/** Change a player's label. An empty label clears it. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void SetLabel(const FString& Id, const FString& Label);

	/**
	 * Show text on a phone, or on every phone when Id is empty. DurationMs 0 keeps it until the next
	 * prompt; empty text clears it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void Prompt(const FString& Text, const FString& Id = TEXT(""), int32 DurationMs = 3000);

	/** Vibrate (Android only). Pattern alternates on and off milliseconds. Empty Id means everyone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void Haptic(const TArray<int32>& Pattern, const FString& Id = TEXT(""));

	/** Vibrate once for DurationMs (Android only). Empty Id means everyone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void HapticPulse(int32 DurationMs = 40, const FString& Id = TEXT(""));

	/** Ask a player (or everyone when Id is empty) to calibrate. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Commands")
	void Calibrate(EPhoneWandCalibrateMode Mode = EPhoneWandCalibrateMode::Screen, const FString& Id = TEXT(""));

	// ------------------------------------------------------------------ layouts (docs/layouts.md)

	/**
	 * Choose the controls a phone shows, or every phone when Id is empty. The relay remembers it
	 * (a phone that reconnects gets it back) and sends OnPlayerChanged with the new layout. Held
	 * buttons that aren't in the new layout are released. An invalid layout changes nothing and
	 * fires OnRelayError.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetLayout(const FPhoneWandLayout& Layout, const FString& Id = TEXT(""));

	/** Go back to the default layout (Primary and Secondary buttons), on one phone or every phone when Id is empty. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void ResetLayout(const FString& Id = TEXT(""));

	/**
	 * Change a control's value on a phone (or every phone when Id is empty): a toggle's Bool, a
	 * slider's Number (0 to 1), a choice's option index (Number) or a label's Text. Every app then
	 * gets OnControlChanged. A value that doesn't fit the control fires OnRelayError.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetControl(const FString& ControlId, const FPhoneWandControlValue& Value, const FString& Id = TEXT(""));

	/** Turn a toggle on or off. Empty Id means every phone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetControlBool(const FString& ControlId, bool bValue, const FString& Id = TEXT(""));

	/** Move a slider (0 to 1). Empty Id means every phone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetControlNumber(const FString& ControlId, double Value, const FString& Id = TEXT(""));

	/** Pick a choice's option by index. Empty Id means every phone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetControlChoice(const FString& ControlId, int32 Index, const FString& Id = TEXT(""));

	/** Change a label's text. Empty Id means every phone. */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Layouts")
	void SetControlText(const FString& ControlId, const FString& Text, const FString& Id = TEXT(""));

	// ------------------------------------------------------------------ events (Blueprint)

	/** The relay said hello. Players already present follow as OnPlayerJoined. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandConnectedEvent OnConnected;

	/** The connection to the relay was lost (after OnPlayerLeft for every player). */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandDisconnectedEvent OnDisconnected;

	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandPlayerEvent OnPlayerJoined;

	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandPlayerEvent OnPlayerLeft;

	/** State, name, colour, label, calibration or transport changed. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandPlayerEvent OnPlayerChanged;

	/** A new pose, typically 60 times a second per player. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandPoseEvent OnPose;

	/** A button went down or up: "primary" or "secondary" by default, or a button id from your layout. Every down is followed by an up. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandButtonEvent OnButton;

	/** A player is pointing at a calibration corner, or cancelled calibration. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandCalibratingEvent OnCalibrating;

	/** A player pressed Recentre (Ray) or finished two-corner calibration (Screen). */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandCalibratedEvent OnCalibrated;

	/** Connection quality, once a second per player. */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandStatsEvent OnStats;

	/**
	 * A toggle, slider, choice or label changed, on the phone or because an app set it. The
	 * player's Controls already hold the new value.
	 */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandControlEvent OnControlChanged;

	/**
	 * The relay couldn't use something this app sent (an invalid layout, a value that doesn't fit a
	 * control); the message says why. When nothing is bound, it is logged as a warning.
	 */
	UPROPERTY(BlueprintAssignable, Category = "Phone Wand|Events")
	FPhoneWandErrorEvent OnRelayError;

	// ------------------------------------------------------------------ events (C++)

	FPhoneWandConnectedNative OnConnectedNative;
	FPhoneWandDisconnectedNative OnDisconnectedNative;
	FPhoneWandPlayerNative OnPlayerJoinedNative;
	FPhoneWandPlayerNative OnPlayerLeftNative;
	FPhoneWandPlayerNative OnPlayerChangedNative;
	FPhoneWandPoseNative OnPoseNative;
	FPhoneWandButtonNative OnButtonNative;
	FPhoneWandCalibratingNative OnCalibratingNative;
	FPhoneWandCalibratedNative OnCalibratedNative;
	FPhoneWandStatsNative OnStatsNative;
	FPhoneWandControlNative OnControlChangedNative;
	FPhoneWandErrorNative OnRelayErrorNative;

	// ------------------------------------------------------------------ message handling

	/**
	 * Handle one relay message (a JSON object), as if it had arrived on the socket. Public so recorded
	 * sessions can be replayed through it, and so you can drive the client from another transport.
	 * Must be called on the game thread.
	 */
	void HandleMessage(const FString& Json);

	/** Handle one already-parsed relay message. */
	void HandleMessageObject(const FJsonObject& Msg);

	/**
	 * Treat the connection as lost: fires OnPlayerLeft for every player, then OnDisconnected if the
	 * relay had said hello. Used internally when the socket closes; public for replays and tests.
	 */
	void HandleConnectionLost();

	/**
	 * C++: send messages to the relay through this function instead of the socket (each is one JSON
	 * object as a string). For tests, and for driving the client over another transport. An unbound
	 * function goes back to the socket.
	 */
	void SetSendOverride(TFunction<void(const FString&)> Send) { SendOverride = MoveTemp(Send); }

private:
	void OpenSocket();
	void CloseSocket();
	void ScheduleReconnect();
	void CancelReconnect();
	bool OnReconnectTimer(float DeltaTime);
	void SendJson(const TSharedRef<FJsonObject>& Msg);
	void SendConfigure();

	void OnSocketConnected();
	void OnSocketError(const FString& Error);
	void OnSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
	void OnSocketMessage(const FString& Message);

	FPhoneWandPlayer& Upsert(const FJsonObject& Info);

	/** Starts the relay check when needed. Returns true when OpenSocket waits for it. */
	bool BeginManagedRelay();
	void FinishRelayCheck(const IHttpRequest* Request, bool bRelayAnswered, int32 Port);
	void LaunchRelay(int32 Port);
	void CancelRelayCheck();

	TSharedPtr<IWebSocket> Socket;
	bool bSocketOpen = false;
	bool bClosedByUser = true;
	bool bAutoReconnect = true;
	float RetryDelay = 0.5f;
	FTSTicker::FDelegateHandle ReconnectHandle;
	FString CurrentUrl;

	EPhoneWandSmoothingMode SmoothingMode = EPhoneWandSmoothingMode::RelayDefault;
	float SmoothMinCutoff = 1.0f;
	float SmoothBeta = 5.0f;
	float SmoothDCutoff = 1.0f;

	bool bStartRelay = false;
	FString RelayPathSetting;
	FString RelayArgumentsSetting;
	TSharedPtr<IHttpRequest, ESPMode::ThreadSafe> RelayCheck;
	FProcHandle RelayProc;
	void* RelayStdinWrite = nullptr;
	int32 RelayPort = 0;
	uint32 RelayProcessId = 0;

	bool bHasHello = false;
	FPhoneWandHello Hello;
	TMap<FString, FPhoneWandPlayer> Players;
	TFunction<void(const FString&)> SendOverride;
};
