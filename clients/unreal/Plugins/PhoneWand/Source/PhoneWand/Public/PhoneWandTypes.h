// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// Data types shared by the subsystem, the Blueprint library and your game code.
// Everything here is already in Unreal's frame (X forward, Y right, Z up); the raw rig-frame
// values from the relay are kept alongside for anyone who needs them.

#pragma once

#include "CoreMinimal.h"
#include "PhoneWandTypes.generated.h"

class FJsonObject;
class FJsonValue;

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

/** Where a layout's controls go on the phone. See docs/layouts.md. */
UENUM(BlueprintType)
enum class EPhoneWandTemplate : uint8
{
	/** One big button (1 control, a button). */
	Primary,
	/** A big button where the thumb rests and a smaller control below it (2 controls). The default. */
	PrimarySecondary,
	/** Two equal controls side by side (2 controls). */
	Pair,
	/** A big button with up to three smaller controls in a row below (1 to 4 controls). */
	PrimaryRow,
	/** Two columns (1 to 6 controls). */
	Grid,
};

/** The kind of a control on the phone. */
UENUM(BlueprintType)
enum class EPhoneWandControlType : uint8
{
	/** Pressed and released: arrives as OnButton with the control's id. */
	Button,
	/** On or off: a Bool value. */
	Toggle,
	/** 0 to 1: a Number value. */
	Slider,
	/** One of 2 to 4 options: a Number value holding the option index (also in Index). */
	Choice,
	/** Text only apps change: a Text value. */
	Label,
	/** Four arrows. Each is a button named <id>.up, <id>.down, <id>.left or <id>.right (see EPhoneWandDpadDirection). */
	Dpad,
	/** Dungeon-crawler keys. Each is a button named <id>.forward, <id>.back, <id>.step-left and so on (see EPhoneWandCrawlDirection). */
	Crawl,
};

/** An arrow of a dpad control. Its button is named <control id>.<direction>, such as move.up. */
UENUM(BlueprintType)
enum class EPhoneWandDpadDirection : uint8
{
	/** "up" */
	Up,
	/** "down" */
	Down,
	/** "left" */
	Left,
	/** "right" */
	Right,
};

/** A key of a crawl control. Its button is named <control id>.<direction>, such as walk.turn-left. */
UENUM(BlueprintType)
enum class EPhoneWandCrawlDirection : uint8
{
	/** "forward" */
	Forward,
	/** "back" */
	Back,
	/** "step-left" */
	StepLeft,
	/** "step-right" */
	StepRight,
	/** "turn-left" */
	TurnLeft,
	/** "turn-right" */
	TurnRight,
};

/** What a control value holds. */
UENUM(BlueprintType)
enum class EPhoneWandValueType : uint8
{
	/** No value (a button, or a control that does not exist). */
	None,
	/** A toggle: bValue. */
	Bool,
	/** A slider (0 to 1) or a choice (the option index, also in Index): Number. */
	Number,
	/** A label's text: Text. */
	Text,
};

/** A deliberate movement of the phone, spotted by the relay. See docs/gestures.md. */
UENUM(BlueprintType)
enum class EPhoneWandGesture : uint8
{
	/** A quick movement towards the screen. */
	Push,
	/** A quick movement back towards the player. */
	Pull,
	/** A quick movement to the left. */
	Left,
	/** A quick movement to the right. */
	Right,
	/** A quick movement upwards. */
	Up,
	/** A quick movement downwards. */
	Down,
	/** Several quick movements back and forth. */
	Shake,
	/** A quick roll of the wrist, anticlockwise as seen from behind. */
	TwistLeft,
	/** A quick roll of the wrist, clockwise as seen from behind. */
	TwistRight,
	/** The pointing direction turned quickly upwards. (After the twists, so saved values keep their meaning.) */
	FlickUp,
	/** The pointing direction turned quickly downwards. */
	FlickDown,
	/** The pointing direction turned quickly to the left. */
	FlickLeft,
	/** The pointing direction turned quickly to the right. */
	FlickRight,
	/** A gesture this plugin does not know yet (from a newer relay): see GestureName. */
	Unknown,
};

/**
 * One control in a layout. Build them with the Make Button / Make Toggle / Make Slider / Make Choice
 * / Make Label / Make Dpad / Make Crawl nodes (UPhoneWandLibrary), or fill the fields yourself. Only
 * the fields for the control's Type are sent.
 */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandControl
{
	GENERATED_BODY()

	/** Your name for the control: 1 to 32 letters, digits, _ . or -, unique in the layout. Button presses and value changes carry it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	FString Id;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	EPhoneWandControlType Type = EPhoneWandControlType::Button;

	/** Text on the control (up to 24 characters). Optional. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	FString Label;

	/** When true, the control is drawn in Colour; otherwise in the player's colour. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	bool bHasColour = false;

	/** The control's colour, sent as #rrggbb. Only used when bHasColour is true. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand", meta = (EditCondition = "bHasColour"))
	FLinearColor Colour = FLinearColor::White;

	/** Toggle: its starting state. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Toggle", meta = (ScriptName = "ToggleValue"))
	bool bValue = false;

	/** Slider: its starting position, 0 to 1. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Slider", meta = (ClampMin = "0", ClampMax = "1"))
	double Value = 0.0;

	/** Slider: vertical instead of horizontal. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Slider")
	bool bVertical = false;

	/** Slider: springs back to Spring when let go (a throttle). Otherwise it stays put. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Slider", meta = (ScriptName = "Springs"))
	bool bSpring = false;

	/** Slider: where it returns when let go, 0 to 1. Only used when bSpring is true. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Slider", meta = (EditCondition = "bSpring", ClampMin = "0", ClampMax = "1"))
	double Spring = 0.0;

	/** Choice: 2 to 4 options, up to 16 characters each. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Choice")
	TArray<FString> Options;

	/** Choice: the index of the starting option. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Choice")
	int32 Index = 0;

	/** Label: its text, up to 80 characters. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand|Label")
	FString Text;
};

/** The controls a phone shows: a template plus its controls, in order. See docs/layouts.md. */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandLayout
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	EPhoneWandTemplate Template = EPhoneWandTemplate::PrimarySecondary;

	/** In order. In the Primary templates the first is the big one and must be a button, dpad or crawl. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	TArray<FPhoneWandControl> Controls;

	/** The control with this id, or null. */
	const FPhoneWandControl* FindControl(const FString& ControlId) const
	{
		return Controls.FindByPredicate([&ControlId](const FPhoneWandControl& C) { return C.Id == ControlId; });
	}
};

/**
 * A control's value: a toggle's Bool, a slider's Number (0 to 1), a choice's Number (the option
 * index, also in Index), or a label's Text. Type says which field holds it.
 */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandControlValue
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	EPhoneWandValueType Type = EPhoneWandValueType::None;

	/** A toggle's state, when Type is Bool. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	bool bValue = false;

	/** A slider's position (0 to 1) or a choice's option index, when Type is Number. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	double Number = 0.0;

	/** Number rounded to a whole number: a choice's option index. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	int32 Index = 0;

	/** A label's text, when Type is Text. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Phone Wand")
	FString Text;

	static FPhoneWandControlValue MakeBool(bool bIn) { FPhoneWandControlValue V; V.Type = EPhoneWandValueType::Bool; V.bValue = bIn; return V; }
	static FPhoneWandControlValue MakeNumber(double In) { FPhoneWandControlValue V; V.Type = EPhoneWandValueType::Number; V.Number = In; V.Index = FMath::RoundToInt32(In); return V; }
	static FPhoneWandControlValue MakeText(const FString& In) { FPhoneWandControlValue V; V.Type = EPhoneWandValueType::Text; V.Text = In; return V; }

	/** For display and logs: "true", "0.8", "2" or the text; empty for None. */
	FString ToString() const;
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

	/** True when Accel holds a value: the phone sends motion data (it does unless motion access was refused). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	bool bHasAccel = false;

	/**
	 * The phone's acceleration in m/s^2, gravity removed, in Unreal's frame (X forward, Y right,
	 * Z up). Not smoothed. For recognising movements yourself; see docs/gestures.md.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FVector Accel = FVector::ZeroVector;

	/** The raw rig-frame acceleration as sent by the relay: X = right, Y = up, Z = forward. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand|Raw")
	FVector RigAccel = FVector::ZeroVector;
};

/**
 * A deliberate movement of the phone: a flick, a shake or a twist. See docs/gestures.md.
 * "Hold Primary and pull back" is a Pull whose Buttons include "primary".
 */
USTRUCT(BlueprintType)
struct PHONEWAND_API FPhoneWandGesture
{
	GENERATED_BODY()

	/** The player who moved. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString Id;

	/** Which gesture. Unknown for one this plugin does not know yet; GestureName still names it. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	EPhoneWandGesture Gesture = EPhoneWandGesture::Unknown;

	/** The gesture's protocol name: movements "push", "pull", "left", "right", "up", "down", "shake"; fast rotations "flick-up", "flick-down", "flick-left", "flick-right", "twist-left", "twist-right". */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FString GestureName;

	/** 0 to 1: how vigorous, relative to a strong flick (or shake, or twist). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Strength = 0.0;

	/** Movements and shakes: peak speed in m/s (0 for flicks and twists). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Speed = 0.0;

	/** Flicks and twists: how far the phone turned, in degrees (0 for movements). */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Angle = 0.0;

	/** Unit direction of the movement in Unreal's frame (X forward, Y right, Z up), for aiming a throw. Zero for shakes and twists. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FVector Direction = FVector::ZeroVector;

	/** The raw rig-frame direction as sent by the relay: X = right, Y = up, Z = forward. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand|Raw")
	FVector RawDirection = FVector::ZeroVector;

	/** How long the movement took, in milliseconds. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Duration = 0.0;

	/** When it started, in relay time: milliseconds since the Unix epoch. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	double Time = 0.0;

	/** Ids of the buttons held when it started, sorted. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	TArray<FString> Buttons;

	/** True when Button was held as the gesture started. Blueprint: Is Button Held (Gesture). */
	bool IsButtonHeld(const FString& Button) const { return Buttons.Contains(Button); }
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

	/** Ids of the buttons held down right now ("primary", "secondary", or your layout's button ids), sorted. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	TArray<FString> Buttons;

	/** True once stats have arrived. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	bool bHasStats = false;

	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FPhoneWandStats Stats;

	/** The controls this player's phone shows. Until an app sends one, the default: PrimarySecondary with buttons "primary" and "secondary". */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	FPhoneWandLayout Layout;

	/** Current values of the layout's toggles, sliders, choices and labels, by control id. Buttons, dpads and crawls have no value. */
	UPROPERTY(BlueprintReadOnly, Category = "Phone Wand")
	TMap<FString, FPhoneWandControlValue> Controls;

	bool IsButtonHeld(const FString& Button) const { return Buttons.Contains(Button); }

	/** The value of a control, or a value of type None when there is none. */
	FPhoneWandControlValue GetControl(const FString& ControlId) const
	{
		const FPhoneWandControlValue* V = Controls.Find(ControlId);
		return V ? *V : FPhoneWandControlValue();
	}
};

namespace PhoneWand
{
	/** The default layout's big button id. */
	inline const TCHAR* const PrimaryButton = TEXT("primary");
	/** The default layout's smaller button id. */
	inline const TCHAR* const SecondaryButton = TEXT("secondary");

	/** Protocol spelling of a template ("primary", "primary-secondary", "pair", "primary-row", "grid"). */
	PHONEWAND_API FString ToString(EPhoneWandTemplate Template);
	/** Protocol spelling of a control type ("button", "toggle", "slider", "choice", "label", "dpad", "crawl"). */
	PHONEWAND_API FString ToString(EPhoneWandControlType Type);
	/** Protocol spelling of a dpad direction ("up", "down", "left", "right"). */
	PHONEWAND_API FString ToString(EPhoneWandDpadDirection Direction);
	/** Protocol spelling of a crawl direction ("forward", "back", "step-left", "step-right", "turn-left", "turn-right"). */
	PHONEWAND_API FString ToString(EPhoneWandCrawlDirection Direction);
	/** Template from its protocol spelling. Returns false for an unknown one. */
	PHONEWAND_API bool ParseTemplate(const FString& Name, EPhoneWandTemplate& Out);
	/** The layout a phone shows until an app sends one: PrimarySecondary with buttons "primary" and "secondary". */
	PHONEWAND_API FPhoneWandLayout DefaultLayout();

	/** A layout as the protocol's JSON object: { "template": ..., "controls": [ ... ] }. */
	PHONEWAND_API TSharedRef<FJsonObject> LayoutToJson(const FPhoneWandLayout& Layout);
	/** One control as the protocol's JSON object. Only the fields for its type are written. */
	PHONEWAND_API TSharedRef<FJsonObject> ControlToJson(const FPhoneWandControl& Control);
	/** A layout from the protocol's JSON. Controls of unknown types are skipped. */
	PHONEWAND_API FPhoneWandLayout LayoutFromJson(const FJsonObject& Json);
	/** A control value as JSON: a boolean, number or string (null for None). */
	PHONEWAND_API TSharedRef<FJsonValue> ControlValueToJson(const FPhoneWandControlValue& Value);
	/** A control value from JSON: booleans, numbers and strings; anything else gives None. */
	PHONEWAND_API FPhoneWandControlValue ControlValueFromJson(const TSharedPtr<FJsonValue>& Json);

	/** Protocol spelling of a player state ("waiting", "active", "paused"). */
	PHONEWAND_API FString ToString(EPhoneWandPlayerState State);
	/** Protocol spelling of a calibration ("none", "ray", "screen"). */
	PHONEWAND_API FString ToString(EPhoneWandCalibration Calibration);
	/** Protocol spelling of a calibration step ("top-left", "bottom-right", "cancelled", or "" for None). */
	PHONEWAND_API FString ToString(EPhoneWandCalibrationStep Step);
	/** Protocol spelling of a gesture ("push", "twist-left", ...; "" for Unknown). */
	PHONEWAND_API FString ToString(EPhoneWandGesture Gesture);
	/** Gesture from its protocol spelling; Unknown for a name this plugin does not know. */
	PHONEWAND_API EPhoneWandGesture ParseGesture(const FString& Name);

	/** The relay's default gesture sensitivity (docs/gestures.md). */
	inline constexpr double DefaultGestureThreshold = 7.0;
	inline constexpr double DefaultGestureMinSpeed = 0.35;
	inline constexpr double DefaultGestureTwistRate = 360.0;
	inline constexpr double DefaultGestureFlickRate = 250.0;
}
