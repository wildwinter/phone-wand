// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

#include "PhoneWandLibrary.h"

#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/GameViewportClient.h"
#include "Engine/World.h"
#include "PhoneWandSubsystem.h"
#include "Policies/CondensedJsonPrintPolicy.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

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

FPhoneWandControl UPhoneWandLibrary::MakeButton(const FString& Id, const FString& Label)
{
	FPhoneWandControl C;
	C.Id = Id;
	C.Type = EPhoneWandControlType::Button;
	C.Label = Label;
	return C;
}

FPhoneWandControl UPhoneWandLibrary::MakeToggle(const FString& Id, const FString& Label, bool bValue)
{
	FPhoneWandControl C = MakeButton(Id, Label);
	C.Type = EPhoneWandControlType::Toggle;
	C.bValue = bValue;
	return C;
}

FPhoneWandControl UPhoneWandLibrary::MakeSlider(const FString& Id, const FString& Label, double Value, bool bVertical, bool bSpring, double Spring)
{
	FPhoneWandControl C = MakeButton(Id, Label);
	C.Type = EPhoneWandControlType::Slider;
	C.Value = Value;
	C.bVertical = bVertical;
	C.bSpring = bSpring;
	C.Spring = Spring;
	return C;
}

FPhoneWandControl UPhoneWandLibrary::MakeChoice(const FString& Id, const TArray<FString>& Options, const FString& Label, int32 Index)
{
	FPhoneWandControl C = MakeButton(Id, Label);
	C.Type = EPhoneWandControlType::Choice;
	C.Options = Options;
	C.Index = Index;
	return C;
}

FPhoneWandControl UPhoneWandLibrary::MakeLabel(const FString& Id, const FString& Label, const FString& Text)
{
	FPhoneWandControl C = MakeButton(Id, Label);
	C.Type = EPhoneWandControlType::Label;
	C.Text = Text;
	return C;
}

FPhoneWandControl UPhoneWandLibrary::WithColour(const FPhoneWandControl& Control, FLinearColor Colour)
{
	FPhoneWandControl C = Control;
	C.bHasColour = true;
	C.Colour = Colour;
	return C;
}

FPhoneWandLayout UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate Template, const TArray<FPhoneWandControl>& Controls)
{
	FPhoneWandLayout Layout;
	Layout.Template = Template;
	Layout.Controls = Controls;
	return Layout;
}

FString UPhoneWandLibrary::LayoutToJson(const FPhoneWandLayout& Layout)
{
	FString Out;
	TSharedRef<TJsonWriter<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>> Writer =
		TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&Out);
	FJsonSerializer::Serialize(PhoneWand::LayoutToJson(Layout), Writer);
	return Out;
}
