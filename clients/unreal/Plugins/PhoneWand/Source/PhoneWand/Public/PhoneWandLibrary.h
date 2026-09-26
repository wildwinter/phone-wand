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
};
