// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "PhoneWandTypes.h"
#include "PhoneWandDemoHUD.generated.h"

class UPhoneWandSubsystem;
class UTexture2D;

/**
 * Draws every player's cursor: a disc in the player's colour at their screen position with their
 * name beside it, a ripple when they press a button, and an arrow at the edge of the
 * screen when they point off it. Also shows the join QR code and a player list. Players have no
 * screen position until they have set up their aim once (or while they calibrate), so above the
 * player list a line in each such player's colour says what they still need to do on their phone.
 * Press L to cycle every phone through a few sample layouts (docs/layouts.md); the latest control
 * change, or gesture (docs/gestures.md, with any held buttons), shows briefly at the top.
 */
UCLASS()
class APhoneWandDemoHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void DrawHUD() override;

private:
	struct FRipple
	{
		FVector2D Screen;
		FLinearColor Colour;
		double Start = 0.0;
	};

	void OnConnected(const FPhoneWandHello& Hello);
	void OnButton(const FPhoneWandPlayer& Player, const FString& Button, bool bDown);
	void OnControlChanged(const FPhoneWandPlayer& Player, const FString& ControlId, const FPhoneWandControlValue& Value);
	void OnGesture(const FPhoneWandPlayer& Player, const FPhoneWandGesture& Gesture);
	void OnRelayError(const FString& Message);
	void UpdateLayoutKey(UPhoneWandSubsystem* Subsystem);
	void DrawLastChange();
	void FetchQrCode(const FString& Url);

	void DrawStatus(UPhoneWandSubsystem* Wand);
	void DrawCursor(const FPhoneWandPlayer& Player);
	void DrawWaiting(const TArray<FPhoneWandPlayer>& Players);
	void DrawEdgeArrow(const FPhoneWandPlayer& Player, FVector2D Target);
	void DrawRipples();
	void DrawRing(FVector2D Centre, float Radius, FLinearColor Colour, float Thickness);
	void DrawLabel(const FString& Text, FVector2D Position, FLinearColor Colour, float Scale = 1.0f);

	TWeakObjectPtr<UPhoneWandSubsystem> Wand;
	FDelegateHandle ConnectedHandle;
	FDelegateHandle ButtonHandle;
	FDelegateHandle ControlHandle;
	FDelegateHandle GestureHandle;
	FDelegateHandle ErrorHandle;

	/** Which sample layout every phone shows: 0 is the default. */
	int32 LayoutIndex = 0;
	/** The latest control change, gesture or relay error, and when it happened. */
	FString LastChange;
	FLinearColor LastChangeColour = FLinearColor::White;
	double LastChangeAt = -100.0;
	TArray<FRipple> Ripples;

	UPROPERTY(Transient)
	TObjectPtr<UTexture2D> QrTexture;

	FString QrForUrl;

	// -PhoneWandDemoShot=<file.png> [-PhoneWandDemoShotDelay=<seconds>]: take one screenshot after the
	// delay (default 5 s) and quit. Used to check the demo from scripts.
	void UpdateAutoScreenshot();
	FString ShotFile;
	double ShotAt = 0.0;
	bool bShotTaken = false;
};
