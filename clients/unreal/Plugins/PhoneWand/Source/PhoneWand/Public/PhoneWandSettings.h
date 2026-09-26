// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "PhoneWandTypes.h"
#include "PhoneWandSettings.generated.h"

/**
 * Project Settings > Plugins > Phone Wand. Stored in Config/DefaultGame.ini under
 * [/Script/PhoneWand.PhoneWandSettings].
 */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Phone Wand"))
class PHONEWAND_API UPhoneWandSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UPhoneWandSettings();

	/** The relay's app endpoint. The -PhoneWandUrl= command-line switch overrides it. */
	UPROPERTY(Config, EditAnywhere, Category = "Connection")
	FString Url = PHONEWAND_DEFAULT_URL;

	/** Connect as soon as the game instance starts. Turn off to call Connect yourself. */
	UPROPERTY(Config, EditAnywhere, Category = "Connection")
	bool bAutoConnect = true;

	/** Keep trying to reconnect (every 0.5 s, backing off to 5 s) when the relay is not there or goes away. */
	UPROPERTY(Config, EditAnywhere, Category = "Connection")
	bool bAutoReconnect = true;

	/**
	 * Start the Phone Wand relay from the game, hidden, when it connects to a relay on this computer
	 * and none is running; stop it when the game stops. Windows, macOS and Linux only. The
	 * -PhoneWandStartRelay command-line switch turns it on too. See docs/shipping.md.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Relay")
	bool bStartRelay = false;

	/**
	 * The phone-wand-relay folder (holding macos, windows-x64, linux-x64, linux-arm64) or the relay
	 * executable itself. Empty uses <plugin>/Resources/Relay/phone-wand-relay. A relative path is
	 * relative to the project folder. The -PhoneWandRelayPath= switch overrides it.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Relay", meta = (EditCondition = "bStartRelay"))
	FString RelayPath;

	/** Extra relay options, for example: --max-players 8 --key party. The -PhoneWandRelayArgs="..." switch overrides it. */
	UPROPERTY(Config, EditAnywhere, Category = "Relay", meta = (EditCondition = "bStartRelay"))
	FString RelayArguments;

	/** How the relay should smooth poses for this app. Sent every time the connection opens. */
	UPROPERTY(Config, EditAnywhere, Category = "Smoothing")
	EPhoneWandSmoothingMode Smoothing = EPhoneWandSmoothingMode::RelayDefault;

	/** One Euro minimum cutoff (Hz). Lower is steadier when still. */
	UPROPERTY(Config, EditAnywhere, Category = "Smoothing", meta = (EditCondition = "Smoothing == EPhoneWandSmoothingMode::Custom", ClampMin = "0.01"))
	float MinCutoff = 1.0f;

	/** One Euro speed coefficient. Higher is quicker when moving. */
	UPROPERTY(Config, EditAnywhere, Category = "Smoothing", meta = (EditCondition = "Smoothing == EPhoneWandSmoothingMode::Custom", ClampMin = "0.0"))
	float Beta = 5.0f;

	/** One Euro derivative cutoff (Hz). */
	UPROPERTY(Config, EditAnywhere, Category = "Smoothing", meta = (EditCondition = "Smoothing == EPhoneWandSmoothingMode::Custom", ClampMin = "0.01"))
	float DCutoff = 1.0f;

	/**
	 * Send this app gesture events (OnGesture). See docs/gestures.md. The gesture settings are sent
	 * every time the connection opens, when they differ from the relay's defaults.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Gestures")
	bool bGestures = true;

	/** Acceleration in m/s^2 that starts a movement. Lower is more sensitive. The relay's default is 7. */
	UPROPERTY(Config, EditAnywhere, Category = "Gestures", meta = (EditCondition = "bGestures", ClampMin = "0.1"))
	double GestureThreshold = PhoneWand::DefaultGestureThreshold;

	/** Peak speed in m/s a movement must reach. The relay's default is 0.35. */
	UPROPERTY(Config, EditAnywhere, Category = "Gestures", meta = (EditCondition = "bGestures", ClampMin = "0.0"))
	double GestureMinSpeed = PhoneWand::DefaultGestureMinSpeed;

	/** Turning speed in degrees per second that makes a flick. The relay's default is 250. */
	UPROPERTY(Config, EditAnywhere, Category = "Gestures", meta = (EditCondition = "bGestures", ClampMin = "1.0"))
	double GestureFlickRate = PhoneWand::DefaultGestureFlickRate;

	/** Roll speed in degrees per second that makes a twist. The relay's default is 360. */
	UPROPERTY(Config, EditAnywhere, Category = "Gestures", meta = (EditCondition = "bGestures", ClampMin = "1.0"))
	double GestureTwistRate = PhoneWand::DefaultGestureTwistRate;
};
