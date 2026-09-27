// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// Conversions between the relay's rig frame and Unreal, plus small helpers.
//
// The rig frame names its axes [right, up, forward]. Unreal is X forward, Y right, Z up, so a rig
// vector [r, u, f] becomes FVector(f, r, u), and a rig quaternion [x, y, z, w] becomes
// FQuat(z, x, y, w). Both frames are left-handed, so nothing is mirrored.

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "PhoneWandTypes.h"
#include "PhoneWandLibrary.generated.h"

class UPhoneWandSubsystem;

UCLASS()
class PHONEWAND_API UPhoneWandLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** The Phone Wand subsystem for the world's game instance, or null. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand", meta = (WorldContext = "WorldContextObject"))
	static UPhoneWandSubsystem* GetPhoneWand(const UObject* WorldContextObject);

	/** Rig vector (X = right, Y = up, Z = forward) to Unreal (X forward, Y right, Z up). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Conversions")
	static FVector RigToUnrealVector(FVector Rig) { return FVector(Rig.Z, Rig.X, Rig.Y); }

	/** Unreal vector to the rig frame (X = right, Y = up, Z = forward). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Conversions")
	static FVector UnrealToRigVector(FVector Unreal) { return FVector(Unreal.Y, Unreal.Z, Unreal.X); }

	/** Rig quaternion (X, Y, Z, W as sent by the relay) to an Unreal quaternion. */
	static FQuat RigToUnrealQuat(const FVector4& Rig) { return FQuat(Rig.Z, Rig.X, Rig.Y, Rig.W); }

	/** Rig quaternion components to an Unreal rotator. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Conversions")
	static FRotator RigToUnrealRotator(double X, double Y, double Z, double W) { return RigToUnrealQuat(FVector4(X, Y, Z, W)).Rotator(); }

	/** Unit pointing direction (Unreal frame) from yaw and pitch in degrees. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Conversions")
	static FVector DirectionFromYawPitch(double Yaw, double Pitch);

	/**
	 * Normalised screen position to pixels in a viewport of the given size. (0,0) is the top-left
	 * corner. Values outside the viewport mean the player points off the screen.
	 */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Screen")
	static FVector2D ScreenToPixels(FVector2D Screen, FVector2D ViewportSize) { return Screen * ViewportSize; }

	/**
	 * A pose's screen position in pixels of the game viewport. Returns false when the pose has no
	 * screen position or there is no viewport.
	 */
	UFUNCTION(BlueprintCallable, Category = "Phone Wand|Screen", meta = (WorldContext = "WorldContextObject"))
	static bool PoseToViewportPixels(const UObject* WorldContextObject, const FPhoneWandPose& Pose, FVector2D& Pixels);

	/** True when the screen position is inside the screen (0..1 on both axes). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Screen")
	static bool IsOnScreen(const FPhoneWandPose& Pose) { return Pose.bHasScreen && Pose.Screen.X >= 0.0 && Pose.Screen.X <= 1.0 && Pose.Screen.Y >= 0.0 && Pose.Screen.Y <= 1.0; }

	/** "#rrggbb" (or "rrggbb") to a linear colour. Invalid input gives white. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Colour")
	static FLinearColor ColourFromHex(const FString& Hex);

	/** A linear colour to "#rrggbb", lower case, as the relay expects. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Colour")
	static FString ColourToHex(FLinearColor Colour);

	/** Protocol name of a player state ("waiting", "active", "paused"). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand", meta = (DisplayName = "To String (Player State)", CompactNodeTitle = "->", BlueprintAutocast))
	static FString PlayerStateToString(EPhoneWandPlayerState State);

	/** Protocol name of a calibration ("none", "ray", "screen"). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand", meta = (DisplayName = "To String (Calibration)", CompactNodeTitle = "->", BlueprintAutocast))
	static FString CalibrationToString(EPhoneWandCalibration Calibration);

	// ------------------------------------------------------------------ gestures (docs/gestures.md)

	/** True when the button ("primary", "secondary" or an id from your layout) was held as the gesture started. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Gestures", meta = (DisplayName = "Is Button Held (Gesture)"))
	static bool IsGestureButtonHeld(const FPhoneWandGesture& Gesture, const FString& Button = TEXT("primary")) { return Gesture.IsButtonHeld(Button); }

	/** Protocol name of a gesture ("push", "pull", "left", "right", "up", "down", "shake", "flick-up", "flick-down", "flick-left", "flick-right", "twist-left", "twist-right"; empty for Unknown). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Gestures", meta = (DisplayName = "To String (Gesture)", CompactNodeTitle = "->", BlueprintAutocast))
	static FString GestureToString(EPhoneWandGesture Gesture) { return PhoneWand::ToString(Gesture); }

	// ------------------------------------------------------------------ buttons and layouts

	/** "primary": the default layout's big button. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FString PrimaryButton() { return PhoneWand::PrimaryButton; }

	/** "secondary": the default layout's smaller button. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FString SecondaryButton() { return PhoneWand::SecondaryButton; }

	/** A button. Presses arrive as On Button with this id. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeButton(const FString& Id, const FString& Label = TEXT(""));

	/** A toggle: on or off. Changes arrive as On Control Changed with a Bool value. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeToggle(const FString& Id, const FString& Label = TEXT(""), bool bValue = false);

	/**
	 * A slider, 0 to 1. With bSpring it returns to Spring when let go (a throttle). Changes arrive
	 * as On Control Changed with a Number value, about 30 times a second while dragging.
	 */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts", meta = (AdvancedDisplay = "bVertical,bSpring,Spring"))
	static FPhoneWandControl MakeSlider(const FString& Id, const FString& Label = TEXT(""), double Value = 0.0, bool bVertical = false, bool bSpring = false, double Spring = 0.0);

	/** A choice of 2 to 4 options. Changes arrive as On Control Changed with the option index. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeChoice(const FString& Id, const TArray<FString>& Options, const FString& Label = TEXT(""), int32 Index = 0);

	/** A label showing text, such as a score. Change it with Set Control Text. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeLabel(const FString& Id, const FString& Label = TEXT(""), const FString& Text = TEXT(""));

	/**
	 * A dpad: four arrows. Each arrow is a button: presses arrive as On Button named Id.up, Id.down,
	 * Id.left or Id.right (Dpad Button gives the name).
	 */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeDpad(const FString& Id, const FString& Label = TEXT(""));

	/**
	 * Dungeon-crawler keys: forward, back, step and turn left and right. Each key is a button:
	 * presses arrive as On Button named Id.forward, Id.turn-left and so on (Crawl Button gives the name).
	 */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl MakeCrawl(const FString& Id, const FString& Label = TEXT(""));

	/** The button name of a dpad arrow, such as "move.up", to compare with On Button's Button or pass to Is Button Held. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FString DpadButton(const FString& ControlId, EPhoneWandDpadDirection Direction) { return ControlId + TEXT(".") + PhoneWand::ToString(Direction); }

	/** The button name of a crawl key, such as "walk.turn-left", to compare with On Button's Button or pass to Is Button Held. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FString CrawlButton(const FString& ControlId, EPhoneWandCrawlDirection Direction) { return ControlId + TEXT(".") + PhoneWand::ToString(Direction); }

	/** The same control drawn in a colour of its own instead of the player's. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControl WithColour(const FPhoneWandControl& Control, FLinearColor Colour);

	/** A layout: a template plus its controls, in order. Send it with Set Layout. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandLayout MakeLayout(EPhoneWandTemplate Template, const TArray<FPhoneWandControl>& Controls);

	/** The layout phones show until an app sends one: Primary Secondary with buttons "primary" and "secondary". */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandLayout DefaultLayout() { return PhoneWand::DefaultLayout(); }

	/** A layout as the JSON the relay receives, for logs and debugging. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FString LayoutToJson(const FPhoneWandLayout& Layout);

	/** Protocol name of a template ("primary", "primary-secondary", "pair", "primary-row", "grid"). */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts", meta = (DisplayName = "To String (Template)", CompactNodeTitle = "->", BlueprintAutocast))
	static FString TemplateToString(EPhoneWandTemplate Template) { return PhoneWand::ToString(Template); }

	/** A Bool control value, for Set Control. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControlValue MakeControlBool(bool bValue) { return FPhoneWandControlValue::MakeBool(bValue); }

	/** A Number control value (a slider's 0 to 1, or a choice's option index), for Set Control. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControlValue MakeControlNumber(double Number) { return FPhoneWandControlValue::MakeNumber(Number); }

	/** A Text control value (a label's text), for Set Control. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts")
	static FPhoneWandControlValue MakeControlText(const FString& Text) { return FPhoneWandControlValue::MakeText(Text); }

	/** A control value as text: "true", "0.8", "2" or the label's text; empty for None. */
	UFUNCTION(BlueprintPure, Category = "Phone Wand|Layouts", meta = (DisplayName = "To String (Control Value)", CompactNodeTitle = "->", BlueprintAutocast))
	static FString ControlValueToString(const FPhoneWandControlValue& Value) { return Value.ToString(); }
};
