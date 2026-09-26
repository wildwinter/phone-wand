// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// Data types shared by the subsystem, the Blueprint library and your game code.
// Everything here is already in Unreal's frame (X forward, Y right, Z up); the raw rig-frame
// values from the relay are kept alongside for anyone who needs them.

#pragma once

#include "CoreMinimal.h"
#include "PhoneWandTypes.generated.h"

/** The protocol version this plugin speaks. */
#define PHONEWAND_PROTOCOL_VERSION 0

/** The relay's default app endpoint. */
#define PHONEWAND_DEFAULT_URL TEXT("ws://127.0.0.1:8480/app")

/** Whether a player is sending poses. */
UENUM(BlueprintType)
enum class EPhoneWandPlayerState : uint8
{
	/** Joined, but has not yet allowed motion access. */
	Waiting,
	/** Sending poses. */
	Active,
	/** Tab hidden, phone locked, or no data for half a second. */
	Paused,
};

/** How a player has calibrated. */
UENUM(BlueprintType)
enum class EPhoneWandCalibration : uint8
{
	/** Not calibrated yet. */
	None,
	/** Recentre pressed: forward is where they pointed. */
	Ray,
	/** Two-corner screen calibration. */
	Screen,
};

/** The corner a player is being asked to point at during screen calibration. */
UENUM(BlueprintType)
enum class EPhoneWandCalibrationStep : uint8
{
	/** Not calibrating. */
	None,
	TopLeft,
	BottomRight,
	/** Calibration was abandoned. Only ever passed to OnCalibrating; a player's step goes back to None. */
	Cancelled,
};

/** Calibration you can ask a player to run. */
UENUM(BlueprintType)
enum class EPhoneWandCalibrateMode : uint8
{
	/** Point at the top-left and bottom-right corners. */
	Screen,
	/** Point at the middle and press Recentre. */
	Ray,
};

/** How the relay smooths the poses it sends this app. */
UENUM(BlueprintType)
enum class EPhoneWandSmoothingMode : uint8
{
	/** Leave the relay's default filter alone. */
	RelayDefault,
	/** Use the One Euro settings given. */
	Custom,
	/** No smoothing at all: raw sensor data. */
	Raw,
};

/** The relay's greeting, received when the connection is ready. */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandHello
{
	GENERATED_BODY()

	/** Protocol version spoken by the relay. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	int32 Protocol = 0;

	/** Relay version string. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Relay;

	/** The URL phones open to join (the one in the QR code). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString JoinUrl;

	/** A PNG of the join QR code. Append ?size=512 for a size in pixels. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString QrUrl;

	/** How many players the relay accepts. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	int32 MaxPlayers = 0;
};

/** One orientation sample from a phone, already calibrated and smoothed by the relay. */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandPose
{
	GENERATED_BODY()

	/** The player this pose belongs to. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Id;

	/** The phone's sample counter. Gaps show dropped samples. Restarts from 0 when the phone reconnects. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	int64 Seq = 0;

	/** When the relay received the sample, in milliseconds since the Unix epoch. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Time = 0.0;

	/** Degrees, positive to the right. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Yaw = 0.0;

	/** Degrees, positive upwards. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Pitch = 0.0;

	/** Degrees, positive when the phone turns clockwise as seen from behind (right edge down). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Roll = 0.0;

	/** Unit pointing direction in Unreal's frame (X forward, Y right, Z up). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FVector Direction = FVector::ForwardVector;

	/** The phone's orientation in Unreal's frame. Rotating +X gives Direction; +Z is out of the screen. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FQuat Rotation = FQuat::Identity;

	/** Rotation as a rotator, for convenience. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FRotator Rotator = FRotator::ZeroRotator;

	/** True when Screen holds a position. False when the phone points more than about 87 degrees from forward. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	bool bHasScreen = false;

	/** Normalised screen position: (0,0) top-left, (1,1) bottom-right. Outside 0..1 is off the screen. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FVector2D Screen = FVector2D::ZeroVector;

	/** The raw rig-frame direction as sent by the relay: X = right, Y = up, Z = forward. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand|Raw")
	FVector RigDirection = FVector(0.0, 0.0, 1.0);

	/** The raw rig-frame quaternion as sent by the relay: X, Y, Z, W. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand|Raw")
	FVector4 RigQuat = FVector4(0.0, 0.0, 0.0, 1.0);
};

/** Connection quality for one player, sent once a second. */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandStats
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Id;

	/** Round trip from relay to phone and back, in milliseconds. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Rtt = 0.0;

	/** Poses per second. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Rate = 0.0;

	/** Samples lost or out of order in the last second. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	int32 Dropped = 0;
};

/** Everything known about one player. */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandPlayer
{
	GENERATED_BODY()

	/** Unique for the lifetime of the relay. Kept when the phone reconnects. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Id;

	/** 0-based player number, lowest free first. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	int32 Slot = 0;

	/** Chosen on the phone. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Name;

	/** "#rrggbb", lower case. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Colour;

	/** Colour as a linear colour, ready for materials and drawing. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FLinearColor LinearColour = FLinearColor::White;

	/** Extra text set with Style. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Label;

	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	EPhoneWandPlayerState State = EPhoneWandPlayerState::Waiting;

	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	EPhoneWandCalibration Calibration = EPhoneWandCalibration::None;

	/** The corner being calibrated right now, or None. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	EPhoneWandCalibrationStep Calibrating = EPhoneWandCalibrationStep::None;

	/** "iOS", "Android" or "other". */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Platform;

	/** "relative-orientation-sensor" or "deviceorientation". */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Sensor;

	/** "ws" or "http". */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Transport;

	/** True once a pose has arrived. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	bool bHasPose = false;

	/** The latest pose, when bHasPose is true. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FPhoneWandPose Pose;

	/** Buttons held down right now ("primary", "secondary"), sorted. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	TArray<FString> Buttons;

	/** True once stats have arrived. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	bool bHasStats = false;

	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FPhoneWandStats Stats;

	bool IsButtonHeld(const FString& Button) const { return Buttons.Contains(Button); }
};

namespace PhoneWand
{
	/** Protocol spelling of a player state ("waiting", "active", "paused"). */
	PHONEWAND_API FString ToString(EPhoneWandPlayerState State);
	/** Protocol spelling of a calibration ("none", "ray", "screen"). */
	PHONEWAND_API FString ToString(EPhoneWandCalibration Calibration);
	/** Protocol spelling of a calibration step ("top-left", "bottom-right", "cancelled", or "" for None). */
	PHONEWAND_API FString ToString(EPhoneWandCalibrationStep Step);
}
