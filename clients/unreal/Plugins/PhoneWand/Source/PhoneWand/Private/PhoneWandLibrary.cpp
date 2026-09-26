// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandLibrary.h"

#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "PhoneWandSubsystem.h"

UPhoneWandSubsystem* UPhoneWandLibrary::GetPhoneWand(const UObject* WorldContextObject)
{
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UPhoneWandSubsystem>() : nullptr;
}

FVector UPhoneWandLibrary::DirectionFromYawPitch(double Yaw, double Pitch)
{
	const double Y = FMath::DegreesToRadians(Yaw);
	const double P = FMath::DegreesToRadians(Pitch);
	// Rig [sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch)], converted to Unreal.
	return RigToUnrealVector(FVector(FMath::Sin(Y) * FMath::Cos(P), FMath::Sin(P), FMath::Cos(Y) * FMath::Cos(P)));
}

bool UPhoneWandLibrary::PoseToViewportPixels(const UObject* WorldContextObject, const FPhoneWandPose& Pose, FVector2D& Pixels)
{
	Pixels = FVector2D::ZeroVector;
	if (!Pose.bHasScreen)
	{
		return false;
	}
	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	UGameViewportClient* Viewport = World ? World->GetGameViewport() : nullptr;
	if (!Viewport)
	{
		return false;
	}
	FVector2D Size;
	Viewport->GetViewportSize(Size);
	if (Size.X <= 0.0 || Size.Y <= 0.0)
	{
		return false;
	}
	Pixels = ScreenToPixels(Pose.Screen, Size);
	return true;
}

FLinearColor UPhoneWandLibrary::ColourFromHex(const FString& Hex)
{
	FString Digits = Hex.TrimStartAndEnd();
	Digits.RemoveFromStart(TEXT("#"));
	if (Digits.Len() != 6)
	{
		return FLinearColor::White;
	}
	for (TCHAR C : Digits)
	{
		if (!FChar::IsHexDigit(C))
		{
			return FLinearColor::White;
		}
	}
	return FLinearColor::FromSRGBColor(FColor::FromHex(Digits));
}

FString UPhoneWandLibrary::ColourToHex(FLinearColor Colour)
{
	const FColor C = Colour.ToFColorSRGB();
	return FString::Printf(TEXT("#%02x%02x%02x"), C.R, C.G, C.B);
}

FString UPhoneWandLibrary::PlayerStateToString(EPhoneWandPlayerState State)
{
	return PhoneWand::ToString(State);
}

FString UPhoneWandLibrary::CalibrationToString(EPhoneWandCalibration Calibration)
{
	return PhoneWand::ToString(Calibration);
}
