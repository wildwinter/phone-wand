// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandDemoGameMode.h"
#include "PhoneWandDemoHUD.h"

APhoneWandDemoGameMode::APhoneWandDemoGameMode()
{
	HUDClass = APhoneWandDemoHUD::StaticClass();
}
