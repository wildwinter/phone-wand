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
};
