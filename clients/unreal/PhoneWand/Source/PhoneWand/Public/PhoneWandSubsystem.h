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
#include "PhoneWandTypes.h"
#include "PhoneWandSubsystem.generated.h"

class IWebSocket;
class FJsonObject;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhoneWandConnectedEvent, const FPhoneWandHello&, Hello);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FPhoneWandDisconnectedEvent);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhoneWandPlayerEvent, const FPhoneWandPlayer&, Player);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandPoseEvent, const FPhoneWandPlayer&, Player, const FPhoneWandPose&, Pose);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FPhoneWandButtonEvent, const FPhoneWandPlayer&, Player, const FString&, Button, bool, bDown);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratingEvent, const FPhoneWandPlayer&, Player, EPhoneWandCalibrationStep, Step);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratedEvent, const FPhoneWandPlayer&, Player, EPhoneWandCalibration, Calibration);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FPhoneWandStatsEvent, const FPhoneWandPlayer&, Player, const FPhoneWandStats&, Stats);

DECLARE_MULTICAST_DELEGATE_OneParam(FPhoneWandConnectedNative, const FPhoneWandHello&);
DECLARE_MULTICAST_DELEGATE(FPhoneWandDisconnectedNative);
DECLARE_MULTICAST_DELEGATE_OneParam(FPhoneWandPlayerNative, const FPhoneWandPlayer&);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandPoseNative, const FPhoneWandPlayer&, const FPhoneWandPose&);
DECLARE_MULTICAST_DELEGATE_ThreeParams(FPhoneWandButtonNative, const FPhoneWandPlayer&, const FString&, bool);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratingNative, const FPhoneWandPlayer&, EPhoneWandCalibrationStep);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandCalibratedNative, const FPhoneWandPlayer&, EPhoneWandCalibration);
DECLARE_MULTICAST_DELEGATE_TwoParams(FPhoneWandStatsNative, const FPhoneWandPlayer&, const FPhoneWandStats&);

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

	/** True while the player holds the button ("primary" or "secondary"). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand")
	bool IsButtonHeld(const FString& Id, const FString& Button = TEXT("primary")) const;

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

	/** A button went down or up. Every down is followed by an up. */
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

	bool bHasHello = false;
	FPhoneWandHello Hello;
	TMap<FString, FPhoneWandPlayer> Players;
};
