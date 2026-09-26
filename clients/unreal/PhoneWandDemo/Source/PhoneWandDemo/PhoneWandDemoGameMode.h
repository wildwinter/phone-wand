// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "PhoneWandDemoGameMode.generated.h"

/** The demo's game mode: nothing but the Phone Wand HUD, over whatever level is open. */
UCLASS()
class APhoneWandDemoGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	APhoneWandDemoGameMode();
};
