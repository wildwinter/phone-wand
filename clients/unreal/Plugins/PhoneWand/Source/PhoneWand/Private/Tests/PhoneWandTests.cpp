// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// Automation tests. Run them from Tools > Session Frontend > Automation (filter "PhoneWand"), or
// headless with scripts/check-unreal.sh.
//
//   PhoneWand.Conformance.Session.<name>  replays conformance/app/<name>.jsonl and compares the
//                                         event log and final state with the recorded ones
//   PhoneWand.Conformance.Conversions     checks conformance/conversions.json
//   PhoneWand.Library                     colour, screen and direction helpers
//   PhoneWand.Client.ConnectionLost       leave and disconnect events when the relay goes away
//   PhoneWand.Layouts.Json                the layout and set messages the plugin sends
//   PhoneWand.Layouts.Client              layouts, control values and errors from the relay
//   PhoneWand.Gestures.Configure          the configure message: smoothing and gesture sensitivity
//   PhoneWand.Gestures.Client             gesture events and pose acceleration from the relay
//   PhoneWand.Live.Relay                  connects to a running relay; only does anything when
//                                         PHONEWAND_LIVE_URL (or -PhoneWandLiveUrl=) is set
//   PhoneWand.Live.Layouts                sends layouts through a running relay to a scripted phone;
//                                         only does anything when PHONEWAND_LAYOUT_LIVE_URL is set
//   PhoneWand.Live.Gestures               a scripted phone flicks while holding Primary through a
//                                         running relay; only does anything when
//                                         PHONEWAND_GESTURE_LIVE_URL is set
//   PhoneWand.ManagedRelay.Paths          URL and relay path rules for Start Relay
//   PhoneWand.ManagedRelay.Missing        with no relay binary: a clear warning, and connecting goes on
//   PhoneWand.ManagedRelay.Live           starts and stops a relay binary; only does anything when
//                                         PHONEWAND_RELAY_DIR (or -PhoneWandRelayDir=) is set
//
// The conformance folder is found relative to the plugin (<repo>/clients/unreal/Plugins/PhoneWand ->
// <repo>/conformance). Override it with the PHONEWAND_CONFORMANCE_DIR environment variable or the
// -PhoneWandConformance=<dir> command-line switch.

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "PhoneWandLibrary.h"
#include "PhoneWandSubsystem.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/Package.h"
#include "UObject/StrongObjectPtr.h"
#include "Engine/GameInstance.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "HAL/PlatformProcess.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace PhoneWandTests
{
	constexpr EAutomationTestFlags Flags = EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter;
	constexpr double Tolerance = 1e-4;

	FString ConformanceDir()
	{
		FString Dir = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_CONFORMANCE_DIR"));
		if (Dir.IsEmpty())
		{
			FParse::Value(FCommandLine::Get(), TEXT("PhoneWandConformance="), Dir);
		}
		if (Dir.IsEmpty())
		{
			if (TSharedPtr<IPlugin> Plugin = IPluginManager::Get().FindPlugin(TEXT("PhoneWand")))
			{
				Dir = FPaths::Combine(Plugin->GetBaseDir(), TEXT(".."), TEXT(".."), TEXT(".."), TEXT(".."), TEXT("conformance"));
			}
		}
		Dir = FPaths::ConvertRelativePathToFull(Dir);
		FPaths::CollapseRelativeDirectories(Dir);
		return Dir;
	}

	/** A client that is not attached to a running game: the subsystem needs a game instance as its outer. */
	TStrongObjectPtr<UPhoneWandSubsystem> MakeWand()
	{
		UGameInstance* GameInstance = NewObject<UGameInstance>(GetTransientPackage());
		return TStrongObjectPtr<UPhoneWandSubsystem>(NewObject<UPhoneWandSubsystem>(GameInstance));
	}

	TSharedPtr<FJsonObject> LoadJson(const FString& Path)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path))
		{
			return nullptr;
		}
		TSharedPtr<FJsonObject> Obj;
		TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Text);
		return FJsonSerializer::Deserialize(Reader, Obj) ? Obj : nullptr;
	}

	TArray<FString> LoadLines(const FString& Path, bool& bOk)
	{
		FString Text;
		bOk = FFileHelper::LoadFileToString(Text, *Path);
		TArray<FString> Lines;
		Text.ParseIntoArrayLines(Lines, /*bCullEmpty*/ false);
		while (Lines.Num() > 0 && Lines.Last().IsEmpty())
		{
			Lines.Pop();
		}
		return Lines;
	}

	/** Records the event log in the conformance format. */
	void AttachLog(UPhoneWandSubsystem* Wand, TArray<FString>& Log)
	{
		Wand->OnConnectedNative.AddLambda([&Log](const FPhoneWandHello& H)
		{
			Log.Add(FString::Printf(TEXT("connected protocol=%d max=%d"), H.Protocol, H.MaxPlayers));
		});
		Wand->OnPlayerJoinedNative.AddLambda([&Log](const FPhoneWandPlayer& P)
		{
			Log.Add(FString::Printf(TEXT("join %s slot=%d name=%s colour=%s"), *P.Id, P.Slot, *P.Name, *P.Colour));
		});
		Wand->OnPlayerChangedNative.AddLambda([&Log](const FPhoneWandPlayer& P)
		{
			Log.Add(FString::Printf(TEXT("player %s state=%s calibration=%s name=%s colour=%s transport=%s"),
				*P.Id, *PhoneWand::ToString(P.State), *PhoneWand::ToString(P.Calibration), *P.Name, *P.Colour, *P.Transport));
		});
		Wand->OnPlayerLeftNative.AddLambda([&Log](const FPhoneWandPlayer& P)
		{
			Log.Add(FString::Printf(TEXT("leave %s"), *P.Id));
		});
		Wand->OnPoseNative.AddLambda([&Log](const FPhoneWandPlayer& P, const FPhoneWandPose& Pose)
		{
			Log.Add(FString::Printf(TEXT("pose %s seq=%lld screen=%s"), *P.Id, (long long)Pose.Seq, Pose.bHasScreen ? TEXT("yes") : TEXT("no")));
		});
		Wand->OnButtonNative.AddLambda([&Log](const FPhoneWandPlayer& P, const FString& Button, bool bDown)
		{
			Log.Add(FString::Printf(TEXT("button %s %s %s"), *P.Id, *Button, bDown ? TEXT("down") : TEXT("up")));
		});
		Wand->OnCalibratingNative.AddLambda([&Log](const FPhoneWandPlayer& P, EPhoneWandCalibrationStep Step)
		{
			Log.Add(FString::Printf(TEXT("calibrating %s %s"), *P.Id, *PhoneWand::ToString(Step)));
		});
		Wand->OnCalibratedNative.AddLambda([&Log](const FPhoneWandPlayer& P, EPhoneWandCalibration Calibration)
		{
			Log.Add(FString::Printf(TEXT("calibrated %s %s"), *P.Id, *PhoneWand::ToString(Calibration)));
		});
		Wand->OnStatsNative.AddLambda([&Log](const FPhoneWandPlayer& P, const FPhoneWandStats&)
		{
			Log.Add(FString::Printf(TEXT("stats %s"), *P.Id));
		});
		Wand->OnControlChangedNative.AddLambda([&Log](const FPhoneWandPlayer& P, const FString& Control, const FPhoneWandControlValue&)
		{
			Log.Add(FString::Printf(TEXT("control %s %s"), *P.Id, *Control));
		});
		Wand->OnGestureNative.AddLambda([&Log](const FPhoneWandPlayer& P, const FPhoneWandGesture& G)
		{
			Log.Add(FString::Printf(TEXT("gesture %s %s buttons=%s"), *P.Id, *G.GestureName,
				G.Buttons.Num() > 0 ? *FString::Join(G.Buttons, TEXT(",")) : TEXT("-")));
		});
		// error fires nothing in the log; bound so the replay does not log warnings.
		Wand->OnRelayErrorNative.AddLambda([](const FString&) {});
	}

	TSharedPtr<FJsonValue> Numbers(std::initializer_list<double> Values)
	{
		TArray<TSharedPtr<FJsonValue>> Arr;
		for (double V : Values)
		{
			Arr.Add(MakeShared<FJsonValueNumber>(V));
		}
		return MakeShared<FJsonValueArray>(Arr);
	}

	/** A player in the conformance state format. Rig-frame values, since that is what is recorded. */
	TSharedPtr<FJsonValue> PlayerToJson(const FPhoneWandPlayer& P)
	{
		TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("id"), P.Id);
		O->SetNumberField(TEXT("slot"), P.Slot);
		O->SetStringField(TEXT("name"), P.Name);
		O->SetStringField(TEXT("colour"), P.Colour);
		O->SetStringField(TEXT("label"), P.Label);
		O->SetStringField(TEXT("state"), PhoneWand::ToString(P.State));
		O->SetStringField(TEXT("calibration"), PhoneWand::ToString(P.Calibration));
		O->SetStringField(TEXT("transport"), P.Transport);
		TArray<TSharedPtr<FJsonValue>> Buttons;
		for (const FString& B : P.Buttons)
		{
			Buttons.Add(MakeShared<FJsonValueString>(B));
		}
		O->SetArrayField(TEXT("buttons"), Buttons);
		O->SetStringField(TEXT("template"), PhoneWand::ToString(P.Layout.Template));
		TSharedRef<FJsonObject> Controls = MakeShared<FJsonObject>();
		for (const TPair<FString, FPhoneWandControlValue>& Pair : P.Controls)
		{
			Controls->SetField(Pair.Key, PhoneWand::ControlValueToJson(Pair.Value));
		}
		O->SetObjectField(TEXT("controls"), Controls);
		if (P.bHasPose)
		{
			const FPhoneWandPose& Pose = P.Pose;
			TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
			J->SetNumberField(TEXT("seq"), (double)Pose.Seq);
			J->SetNumberField(TEXT("t"), Pose.Time);
			J->SetNumberField(TEXT("yaw"), Pose.Yaw);
			J->SetNumberField(TEXT("pitch"), Pose.Pitch);
			J->SetNumberField(TEXT("roll"), Pose.Roll);
			J->SetField(TEXT("q"), Numbers({ Pose.RigQuat.X, Pose.RigQuat.Y, Pose.RigQuat.Z, Pose.RigQuat.W }));
			J->SetField(TEXT("dir"), Numbers({ Pose.RigDirection.X, Pose.RigDirection.Y, Pose.RigDirection.Z }));
			if (Pose.bHasScreen)
			{
				J->SetField(TEXT("screen"), Numbers({ Pose.Screen.X, Pose.Screen.Y }));
			}
			else
			{
				J->SetField(TEXT("screen"), MakeShared<FJsonValueNull>());
			}
			O->SetObjectField(TEXT("pose"), J);
		}
		else
		{
			O->SetField(TEXT("pose"), MakeShared<FJsonValueNull>());
		}
		return MakeShared<FJsonValueObject>(O);
	}

	/** Compares every field of Expected with Actual: strings exactly, numbers to Tolerance. */
	/** With bStrict, fields Actual has and Expected lacks are errors too. */
	void CompareJson(FAutomationTestBase& Test, const FString& Path, const TSharedPtr<FJsonValue>& Expected, const TSharedPtr<FJsonValue>& Actual, bool bStrict = false)
	{
		if (!Actual.IsValid())
		{
			Test.AddError(FString::Printf(TEXT("%s: missing"), *Path));
			return;
		}
		if (Expected->Type != Actual->Type)
		{
			Test.AddError(FString::Printf(TEXT("%s: expected type %d, got %d"), *Path, (int32)Expected->Type, (int32)Actual->Type));
			return;
		}
		switch (Expected->Type)
		{
		case EJson::Null:
			break;
		case EJson::String:
			if (Expected->AsString() != Actual->AsString())
			{
				Test.AddError(FString::Printf(TEXT("%s: expected \"%s\", got \"%s\""), *Path, *Expected->AsString(), *Actual->AsString()));
			}
			break;
		case EJson::Number:
			if (FMath::Abs(Expected->AsNumber() - Actual->AsNumber()) > Tolerance)
			{
				Test.AddError(FString::Printf(TEXT("%s: expected %f, got %f"), *Path, Expected->AsNumber(), Actual->AsNumber()));
			}
			break;
		case EJson::Boolean:
			if (Expected->AsBool() != Actual->AsBool())
			{
				Test.AddError(FString::Printf(TEXT("%s: boolean differs"), *Path));
			}
			break;
		case EJson::Array:
		{
			const TArray<TSharedPtr<FJsonValue>>& E = Expected->AsArray();
			const TArray<TSharedPtr<FJsonValue>>& A = Actual->AsArray();
			if (E.Num() != A.Num())
			{
				Test.AddError(FString::Printf(TEXT("%s: expected %d items, got %d"), *Path, E.Num(), A.Num()));
				return;
			}
			for (int32 i = 0; i < E.Num(); ++i)
			{
				CompareJson(Test, FString::Printf(TEXT("%s[%d]"), *Path, i), E[i], A[i], bStrict);
			}
			break;
		}
		case EJson::Object:
		{
			const TSharedPtr<FJsonObject> E = Expected->AsObject();
			const TSharedPtr<FJsonObject> A = Actual->AsObject();
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : E->Values)
			{
				CompareJson(Test, Path + TEXT(".") + Pair.Key, Pair.Value, A->TryGetField(Pair.Key), bStrict);
			}
			// A player's control values must match exactly, with nothing extra. (Elsewhere the
			// client may hold more than the recording, such as a pose's time.)
			if (bStrict || Path.EndsWith(TEXT(".controls")))
			{
				for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : A->Values)
				{
					if (!E->HasField(Pair.Key))
					{
						Test.AddError(FString::Printf(TEXT("%s.%s: unexpected"), *Path, *Pair.Key));
					}
				}
			}
			break;
		}
		default:
			break;
		}
	}

	bool ReadVector(const TSharedPtr<FJsonObject>& Obj, const TCHAR* Field, double* Out, int32 Count)
	{
		const TArray<TSharedPtr<FJsonValue>>* Arr = nullptr;
		if (!Obj.IsValid() || !Obj->TryGetArrayField(Field, Arr) || Arr->Num() != Count)
		{
			return false;
		}
		for (int32 i = 0; i < Count; ++i)
		{
			Out[i] = (*Arr)[i]->AsNumber();
		}
		return true;
	}

	bool Near(const FVector& A, const FVector& B)
	{
		return A.Equals(B, Tolerance);
	}
}

// ---------------------------------------------------------------------- sessions

IMPLEMENT_COMPLEX_AUTOMATION_TEST(FPhoneWandConformanceSessionTest, "PhoneWand.Conformance.Session", PhoneWandTests::Flags)

void FPhoneWandConformanceSessionTest::GetTests(TArray<FString>& OutBeautifiedNames, TArray<FString>& OutTestCommands) const
{
	const FString Dir = PhoneWandTests::ConformanceDir();
	TSharedPtr<FJsonObject> Index = PhoneWandTests::LoadJson(FPaths::Combine(Dir, TEXT("index.json")));
	const TArray<TSharedPtr<FJsonValue>>* Sessions = nullptr;
	if (!Index.IsValid() || !Index->TryGetArrayField(TEXT("sessions"), Sessions) || Sessions->Num() == 0)
	{
		// Still list one test, so a missing suite shows up as a failure rather than as nothing.
		OutBeautifiedNames.Add(TEXT("IndexMissing"));
		OutTestCommands.Add(FString());
		return;
	}
	for (const TSharedPtr<FJsonValue>& V : *Sessions)
	{
		OutBeautifiedNames.Add(V->AsString());
		OutTestCommands.Add(V->AsString());
	}
}

bool FPhoneWandConformanceSessionTest::RunTest(const FString& Session)
{
	const FString Dir = PhoneWandTests::ConformanceDir();
	if (Session.IsEmpty())
	{
		AddError(FString::Printf(TEXT("No conformance sessions found: %s/index.json is missing or empty. Set PHONEWAND_CONFORMANCE_DIR."), *Dir));
		return false;
	}

	TSharedPtr<FJsonObject> Index = PhoneWandTests::LoadJson(FPaths::Combine(Dir, TEXT("index.json")));
	int32 Protocol = -1;
	if (Index.IsValid() && Index->TryGetNumberField(TEXT("protocol"), Protocol))
	{
		TestEqual(TEXT("conformance protocol version"), Protocol, PHONEWAND_PROTOCOL_VERSION);
	}

	bool bOk = false;
	const TArray<FString> Input = PhoneWandTests::LoadLines(FPaths::Combine(Dir, TEXT("app"), Session + TEXT(".jsonl")), bOk);
	if (!bOk)
	{
		AddError(FString::Printf(TEXT("Cannot read app/%s.jsonl in %s"), *Session, *Dir));
		return false;
	}
	const TArray<FString> Expected = PhoneWandTests::LoadLines(FPaths::Combine(Dir, TEXT("app"), Session + TEXT(".events.txt")), bOk);
	if (!bOk)
	{
		AddError(FString::Printf(TEXT("Cannot read app/%s.events.txt"), *Session));
		return false;
	}
	TSharedPtr<FJsonObject> State = PhoneWandTests::LoadJson(FPaths::Combine(Dir, TEXT("app"), Session + TEXT(".state.json")));
	if (!State.IsValid())
	{
		AddError(FString::Printf(TEXT("Cannot read app/%s.state.json"), *Session));
		return false;
	}

	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FString> Log;
	PhoneWandTests::AttachLog(Wand.Get(), Log);
	for (const FString& Line : Input)
	{
		if (!Line.TrimStartAndEnd().IsEmpty())
		{
			Wand->HandleMessage(Line);
		}
	}

	// Event log, line for line.
	const int32 Common = FMath::Min(Log.Num(), Expected.Num());
	for (int32 i = 0; i < Common; ++i)
	{
		if (Log[i] != Expected[i])
		{
			AddError(FString::Printf(TEXT("event %d: expected \"%s\", got \"%s\""), i + 1, *Expected[i], *Log[i]));
			break;
		}
	}
	TestEqual(TEXT("event count"), Log.Num(), Expected.Num());

	// Final state, in slot order.
	TArray<TSharedPtr<FJsonValue>> Actual;
	for (const FPhoneWandPlayer& P : Wand->GetPlayers())
	{
		Actual.Add(PhoneWandTests::PlayerToJson(P));
	}
	PhoneWandTests::CompareJson(*this, TEXT("players"), State->TryGetField(TEXT("players")), MakeShared<FJsonValueArray>(Actual));

	AddInfo(FString::Printf(TEXT("%s: %d events, %d players"), *Session, Log.Num(), Actual.Num()));
	return !HasAnyErrors();
}

// ---------------------------------------------------------------------- conversions

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandConversionsTest, "PhoneWand.Conformance.Conversions", PhoneWandTests::Flags)

bool FPhoneWandConversionsTest::RunTest(const FString& Parameters)
{
	const FString Dir = PhoneWandTests::ConformanceDir();
	TSharedPtr<FJsonObject> Root = PhoneWandTests::LoadJson(FPaths::Combine(Dir, TEXT("conversions.json")));
	const TArray<TSharedPtr<FJsonValue>>* Cases = nullptr;
	if (!Root.IsValid() || !Root->TryGetArrayField(TEXT("cases"), Cases) || Cases->Num() == 0)
	{
		AddError(FString::Printf(TEXT("Cannot read %s/conversions.json"), *Dir));
		return false;
	}

	int32 CaseIndex = 0;
	for (const TSharedPtr<FJsonValue>& V : *Cases)
	{
		++CaseIndex;
		const TSharedPtr<FJsonObject> Case = V->AsObject();
		const TSharedPtr<FJsonObject> Rig = Case->GetObjectField(TEXT("rig"));
		const TSharedPtr<FJsonObject> Ue = Case->GetObjectField(TEXT("unreal"));
		double RQ[4], RD[3], RU[3], UQ[4], UD[3], UU[3];
		if (!PhoneWandTests::ReadVector(Rig, TEXT("q"), RQ, 4) || !PhoneWandTests::ReadVector(Rig, TEXT("dir"), RD, 3) ||
			!PhoneWandTests::ReadVector(Rig, TEXT("up"), RU, 3) || !PhoneWandTests::ReadVector(Ue, TEXT("q"), UQ, 4) ||
			!PhoneWandTests::ReadVector(Ue, TEXT("dir"), UD, 3) || !PhoneWandTests::ReadVector(Ue, TEXT("up"), UU, 3))
		{
			AddError(FString::Printf(TEXT("case %d: malformed"), CaseIndex));
			continue;
		}

		const FQuat Q = UPhoneWandLibrary::RigToUnrealQuat(FVector4(RQ[0], RQ[1], RQ[2], RQ[3]));
		const FQuat Want(UQ[0], UQ[1], UQ[2], UQ[3]);
		const bool bSame = FMath::Abs(Q.X - Want.X) <= PhoneWandTests::Tolerance && FMath::Abs(Q.Y - Want.Y) <= PhoneWandTests::Tolerance &&
			FMath::Abs(Q.Z - Want.Z) <= PhoneWandTests::Tolerance && FMath::Abs(Q.W - Want.W) <= PhoneWandTests::Tolerance;
		if (!bSame)
		{
			AddError(FString::Printf(TEXT("case %d: quaternion expected %s, got %s"), CaseIndex, *Want.ToString(), *Q.ToString()));
		}

		const FVector WantDir(UD[0], UD[1], UD[2]);
		const FVector WantUp(UU[0], UU[1], UU[2]);
		const FVector Dir3 = UPhoneWandLibrary::RigToUnrealVector(FVector(RD[0], RD[1], RD[2]));
		const FVector Up3 = UPhoneWandLibrary::RigToUnrealVector(FVector(RU[0], RU[1], RU[2]));
		if (!PhoneWandTests::Near(Dir3, WantDir))
		{
			AddError(FString::Printf(TEXT("case %d: dir expected %s, got %s"), CaseIndex, *WantDir.ToString(), *Dir3.ToString()));
		}
		if (!PhoneWandTests::Near(Up3, WantUp))
		{
			AddError(FString::Printf(TEXT("case %d: up expected %s, got %s"), CaseIndex, *WantUp.ToString(), *Up3.ToString()));
		}

		// Rotating Unreal's own forward (+X) and up (+Z) by the converted quaternion.
		const FVector Fwd = Q.RotateVector(FVector::ForwardVector);
		const FVector Up = Q.RotateVector(FVector::UpVector);
		if (!PhoneWandTests::Near(Fwd, WantDir))
		{
			AddError(FString::Printf(TEXT("case %d: q * forward expected %s, got %s"), CaseIndex, *WantDir.ToString(), *Fwd.ToString()));
		}
		if (!PhoneWandTests::Near(Up, WantUp))
		{
			AddError(FString::Printf(TEXT("case %d: q * up expected %s, got %s"), CaseIndex, *WantUp.ToString(), *Up.ToString()));
		}

		// The rotator must describe the same orientation.
		const FQuat FromRotator = UPhoneWandLibrary::RigToUnrealRotator(RQ[0], RQ[1], RQ[2], RQ[3]).Quaternion();
		if (!PhoneWandTests::Near(FromRotator.RotateVector(FVector::ForwardVector), WantDir) ||
			!PhoneWandTests::Near(FromRotator.RotateVector(FVector::UpVector), WantUp))
		{
			AddError(FString::Printf(TEXT("case %d: rotator does not match the quaternion"), CaseIndex));
		}
	}
	AddInfo(FString::Printf(TEXT("%d conversion cases"), Cases->Num()));
	return !HasAnyErrors();
}

// ---------------------------------------------------------------------- library

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandLibraryTest, "PhoneWand.Library", PhoneWandTests::Flags)

bool FPhoneWandLibraryTest::RunTest(const FString& Parameters)
{
	TestTrue(TEXT("#ff0000 is red"), UPhoneWandLibrary::ColourFromHex(TEXT("#ff0000")).Equals(FLinearColor::Red, 1e-4f));
	TestTrue(TEXT("ffffff without # is white"), UPhoneWandLibrary::ColourFromHex(TEXT("ffffff")).Equals(FLinearColor::White, 1e-4f));
	TestTrue(TEXT("invalid hex is white"), UPhoneWandLibrary::ColourFromHex(TEXT("#zz")).Equals(FLinearColor::White, 1e-4f));
	TestEqual(TEXT("hex round trip"), UPhoneWandLibrary::ColourToHex(UPhoneWandLibrary::ColourFromHex(TEXT("#FF4D6D"))), FString(TEXT("#ff4d6d")));

	TestTrue(TEXT("screen to pixels"), UPhoneWandLibrary::ScreenToPixels(FVector2D(0.25, 0.5), FVector2D(1920, 1080)).Equals(FVector2D(480, 540), 1e-6));

	TestTrue(TEXT("yaw 0 pitch 0 is forward"), PhoneWandTests::Near(UPhoneWandLibrary::DirectionFromYawPitch(0, 0), FVector::ForwardVector));
	TestTrue(TEXT("yaw 90 is right"), PhoneWandTests::Near(UPhoneWandLibrary::DirectionFromYawPitch(90, 0), FVector::RightVector));
	TestTrue(TEXT("pitch 90 is up"), PhoneWandTests::Near(UPhoneWandLibrary::DirectionFromYawPitch(0, 90), FVector::UpVector));
	TestTrue(TEXT("rig [r,u,f] = [1,2,3] is Unreal (3,1,2)"), UPhoneWandLibrary::RigToUnrealVector(FVector(1, 2, 3)) == FVector(3, 1, 2));
	TestTrue(TEXT("vector round trip"), UPhoneWandLibrary::UnrealToRigVector(UPhoneWandLibrary::RigToUnrealVector(FVector(1, 2, 3))) == FVector(1, 2, 3));

	// A pose's Direction and Rotation agree with each other and with the yaw and pitch.
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	Wand->HandleMessage(TEXT("{\"type\":\"hello\",\"protocol\":0,\"maxPlayers\":4,\"players\":[{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"colour\":\"#ff4d6d\",\"state\":\"active\"}]}"));
	Wand->HandleMessage(TEXT("{\"type\":\"pose\",\"id\":\"p1\",\"seq\":7,\"t\":1790300000123.4,\"q\":[0,0.258819,0,0.965926],\"yaw\":30,\"pitch\":0,\"roll\":0,\"dir\":[0.5,0,0.866025],\"screen\":null}"));
	FPhoneWandPlayer P;
	if (TestTrue(TEXT("player exists"), Wand->GetPlayer(TEXT("p1"), P)))
	{
		TestTrue(TEXT("has pose"), P.bHasPose);
		TestFalse(TEXT("null screen"), P.Pose.bHasScreen);
		TestEqual(TEXT("seq"), P.Pose.Seq, (int64)7);
		TestEqual(TEXT("time keeps double precision"), P.Pose.Time, 1790300000123.4, 1e-3);
		TestTrue(TEXT("direction"), PhoneWandTests::Near(P.Pose.Direction, FVector(0.866025, 0.5, 0)));
		TestTrue(TEXT("rotation forward"), PhoneWandTests::Near(P.Pose.Rotation.RotateVector(FVector::ForwardVector), P.Pose.Direction));
		TestTrue(TEXT("yaw/pitch direction"), PhoneWandTests::Near(UPhoneWandLibrary::DirectionFromYawPitch(P.Pose.Yaw, P.Pose.Pitch), P.Pose.Direction));
		TestEqual(TEXT("rotator yaw"), P.Pose.Rotator.Yaw, 30.0, 1e-3);
		TestTrue(TEXT("linear colour"), P.LinearColour.Equals(UPhoneWandLibrary::ColourFromHex(TEXT("#ff4d6d"))));
	}
	return !HasAnyErrors();
}

// ---------------------------------------------------------------------- connection lost

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandConnectionLostTest, "PhoneWand.Client.ConnectionLost", PhoneWandTests::Flags)

bool FPhoneWandConnectionLostTest::RunTest(const FString& Parameters)
{
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FString> Log;
	PhoneWandTests::AttachLog(Wand.Get(), Log);
	int32 Disconnects = 0;
	Wand->OnDisconnectedNative.AddLambda([&Disconnects, &Log]() { ++Disconnects; Log.Add(TEXT("disconnected")); });

	Wand->HandleMessage(TEXT("{\"type\":\"hello\",\"protocol\":0,\"maxPlayers\":4,\"players\":[{\"id\":\"p2\",\"slot\":1,\"name\":\"B\",\"colour\":\"#2ec4ff\"},{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"colour\":\"#ff4d6d\"}]}"));
	Wand->HandleMessage(TEXT("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"primary\",\"down\":true}"));
	Wand->HandleMessage(TEXT("{\"type\":\"button\",\"id\":\"nobody\",\"button\":\"primary\",\"down\":true}"));
	Wand->HandleMessage(TEXT("not json"));
	Wand->HandleMessage(TEXT("{\"type\":\"something-new\",\"id\":\"p1\"}"));
	TestTrue(TEXT("connected"), Wand->IsConnected());
	TestTrue(TEXT("primary held"), Wand->IsButtonHeld(TEXT("p1"), TEXT("primary")));
	const TArray<FPhoneWandPlayer> Sorted = Wand->GetPlayers();
	TestTrue(TEXT("sorted by slot"), Sorted.Num() == 2 && Sorted[0].Id == TEXT("p1") && Sorted[1].Id == TEXT("p2"));

	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"state\":\"paused\"}}"));
	TestFalse(TEXT("paused clears buttons"), Wand->IsButtonHeld(TEXT("p1"), TEXT("primary")));
	FPhoneWandPlayer P;
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("partial update keeps name"), P.Name, FString(TEXT("A")));

	Log.Reset();
	Wand->HandleConnectionLost();
	TestFalse(TEXT("not connected"), Wand->IsConnected());
	TestEqual(TEXT("players cleared"), Wand->GetPlayerCount(), 0);
	TestEqual(TEXT("one disconnect"), Disconnects, 1);
	TestTrue(TEXT("leaves then disconnected"), Log.Num() == 3 && Log[0].StartsWith(TEXT("leave ")) && Log[1].StartsWith(TEXT("leave ")) && Log[2] == TEXT("disconnected"));

	Wand->HandleConnectionLost();
	TestEqual(TEXT("no second disconnect"), Disconnects, 1);
	return !HasAnyErrors();
}

// ---------------------------------------------------------------------- layouts

namespace PhoneWandTests
{
	TSharedPtr<FJsonValue> ParseValue(const FString& Json)
	{
		TSharedPtr<FJsonValue> Value;
		TSharedRef<TJsonReader<TCHAR>> Reader = TJsonReaderFactory<TCHAR>::Create(Json);
		return FJsonSerializer::Deserialize(Reader, Value) ? Value : nullptr;
	}

	/** Parses Actual and Expected and compares them strictly: same fields, same values. */
	void ExpectJson(FAutomationTestBase& Test, const FString& What, const FString& Actual, const FString& Expected)
	{
		const TSharedPtr<FJsonValue> A = ParseValue(Actual);
		const TSharedPtr<FJsonValue> E = ParseValue(Expected);
		if (!Test.TestTrue(What + TEXT(": sent valid JSON"), A.IsValid()) || !Test.TestTrue(What + TEXT(": expected JSON parses"), E.IsValid()))
		{
			return;
		}
		const bool bBefore = Test.HasAnyErrors();
		CompareJson(Test, What, E, A, /*bStrict*/ true);
		if (!bBefore && Test.HasAnyErrors())
		{
			Test.AddInfo(FString::Printf(TEXT("%s sent: %s"), *What, *Actual));
		}
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandLayoutJsonTest, "PhoneWand.Layouts.Json", PhoneWandTests::Flags)

bool FPhoneWandLayoutJsonTest::RunTest(const FString& Parameters)
{
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FString> Sent;
	Wand->SetSendOverride([&Sent](const FString& Json) { Sent.Add(Json); });

	// The example from docs/protocol.md ("Layouts"), plus a colour.
	const FPhoneWandLayout Shooter = UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::PrimaryRow, {
		UPhoneWandLibrary::WithColour(UPhoneWandLibrary::MakeButton(TEXT("shoot"), TEXT("Shoot")), UPhoneWandLibrary::ColourFromHex(TEXT("#00ff88"))),
		UPhoneWandLibrary::MakeButton(TEXT("reload"), TEXT("Reload")),
		UPhoneWandLibrary::MakeToggle(TEXT("zoom"), TEXT("Zoom")),
		UPhoneWandLibrary::MakeLabel(TEXT("ammo"), TEXT("Ammo"), TEXT("12")),
	});
	Wand->SetLayout(Shooter, TEXT("p1"));

	// Every other control type and option.
	const FPhoneWandLayout Grid = UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::Grid, {
		UPhoneWandLibrary::MakeButton(TEXT("fire")),
		UPhoneWandLibrary::MakeToggle(TEXT("shield"), TEXT("Shield"), true),
		UPhoneWandLibrary::MakeSlider(TEXT("power"), TEXT("Power"), 0.25),
		UPhoneWandLibrary::MakeSlider(TEXT("throttle"), FString(), 0.5, /*bVertical*/ true, /*bSpring*/ true, 0.5),
		UPhoneWandLibrary::MakeChoice(TEXT("weapon"), { TEXT("Bow"), TEXT("Sling"), TEXT("Net") }, FString(), 1),
		UPhoneWandLibrary::MakeLabel(TEXT("score"), TEXT("Score"), TEXT("0")),
	});
	Wand->SetLayout(Grid);

	// Direction controls: no value fields, a colour like any other control.
	const FPhoneWandLayout Crawler = UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::PrimaryRow, {
		UPhoneWandLibrary::MakeCrawl(TEXT("walk"), TEXT("Walk")),
		UPhoneWandLibrary::WithColour(UPhoneWandLibrary::MakeDpad(TEXT("move")), UPhoneWandLibrary::ColourFromHex(TEXT("#3388ff"))),
	});
	Wand->SetLayout(Crawler, TEXT("p1"));

	// Rows and columns: counts always, sizes only when given.
	const FPhoneWandLayout Rows = UPhoneWandLibrary::MakeRowsLayout({ 1, 3 }, {
		UPhoneWandLibrary::MakeCrawl(TEXT("walk")),
		UPhoneWandLibrary::MakeButton(TEXT("use"), TEXT("Use")),
		UPhoneWandLibrary::MakeToggle(TEXT("torch"), TEXT("Torch")),
		UPhoneWandLibrary::MakeLabel(TEXT("gold"), TEXT("Gold"), TEXT("0")),
	}, { 3.0, 2.0 });
	Wand->SetLayout(Rows);
	const FPhoneWandLayout Columns = UPhoneWandLibrary::MakeColumnsLayout({ 1, 2 }, {
		UPhoneWandLibrary::MakeSlider(TEXT("throttle"), FString(), 0.0, /*bVertical*/ true),
		UPhoneWandLibrary::MakeButton(TEXT("fire")),
		UPhoneWandLibrary::MakeDpad(TEXT("move")),
	}, {});
	Wand->SetLayout(Columns, TEXT("p1"));

	Wand->ResetLayout(TEXT("p2"));
	Wand->ResetLayout();
	Wand->SetControlBool(TEXT("zoom"), false, TEXT("p1"));
	Wand->SetControlNumber(TEXT("power"), 0.8);
	Wand->SetControlChoice(TEXT("weapon"), 2, TEXT("p1"));
	Wand->SetControlText(TEXT("ammo"), TEXT("11"), TEXT("p1"));
	Wand->SetControl(TEXT("shield"), UPhoneWandLibrary::MakeControlBool(true));

	const TCHAR* Expected[] = {
		TEXT("{\"type\":\"layout\",\"id\":\"p1\",\"layout\":{\"template\":\"primary-row\",\"controls\":[")
			TEXT("{\"id\":\"shoot\",\"type\":\"button\",\"label\":\"Shoot\",\"colour\":\"#00ff88\"},")
			TEXT("{\"id\":\"reload\",\"type\":\"button\",\"label\":\"Reload\"},")
			TEXT("{\"id\":\"zoom\",\"type\":\"toggle\",\"label\":\"Zoom\",\"value\":false},")
			TEXT("{\"id\":\"ammo\",\"type\":\"label\",\"label\":\"Ammo\",\"text\":\"12\"}]}}"),
		TEXT("{\"type\":\"layout\",\"layout\":{\"template\":\"grid\",\"controls\":[")
			TEXT("{\"id\":\"fire\",\"type\":\"button\"},")
			TEXT("{\"id\":\"shield\",\"type\":\"toggle\",\"label\":\"Shield\",\"value\":true},")
			TEXT("{\"id\":\"power\",\"type\":\"slider\",\"label\":\"Power\",\"value\":0.25,\"orientation\":\"horizontal\",\"spring\":null},")
			TEXT("{\"id\":\"throttle\",\"type\":\"slider\",\"value\":0.5,\"orientation\":\"vertical\",\"spring\":0.5},")
			TEXT("{\"id\":\"weapon\",\"type\":\"choice\",\"options\":[\"Bow\",\"Sling\",\"Net\"],\"value\":1},")
			TEXT("{\"id\":\"score\",\"type\":\"label\",\"label\":\"Score\",\"text\":\"0\"}]}}"),
		TEXT("{\"type\":\"layout\",\"id\":\"p1\",\"layout\":{\"template\":\"primary-row\",\"controls\":[")
			TEXT("{\"id\":\"walk\",\"type\":\"crawl\",\"label\":\"Walk\"},")
			TEXT("{\"id\":\"move\",\"type\":\"dpad\",\"colour\":\"#3388ff\"}]}}"),
		TEXT("{\"type\":\"layout\",\"layout\":{\"template\":\"rows\",\"controls\":[")
			TEXT("{\"id\":\"walk\",\"type\":\"crawl\"},")
			TEXT("{\"id\":\"use\",\"type\":\"button\",\"label\":\"Use\"},")
			TEXT("{\"id\":\"torch\",\"type\":\"toggle\",\"label\":\"Torch\",\"value\":false},")
			TEXT("{\"id\":\"gold\",\"type\":\"label\",\"label\":\"Gold\",\"text\":\"0\"}],")
			TEXT("\"rows\":[1,3],\"heights\":[3,2]}}"),
		TEXT("{\"type\":\"layout\",\"id\":\"p1\",\"layout\":{\"template\":\"columns\",\"controls\":[")
			TEXT("{\"id\":\"throttle\",\"type\":\"slider\",\"value\":0,\"orientation\":\"vertical\",\"spring\":null},")
			TEXT("{\"id\":\"fire\",\"type\":\"button\"},")
			TEXT("{\"id\":\"move\",\"type\":\"dpad\"}],")
			TEXT("\"columns\":[1,2]}}"),
		TEXT("{\"type\":\"layout\",\"id\":\"p2\",\"layout\":null}"),
		TEXT("{\"type\":\"layout\",\"layout\":null}"),
		TEXT("{\"type\":\"set\",\"id\":\"p1\",\"control\":\"zoom\",\"value\":false}"),
		TEXT("{\"type\":\"set\",\"control\":\"power\",\"value\":0.8}"),
		TEXT("{\"type\":\"set\",\"id\":\"p1\",\"control\":\"weapon\",\"value\":2}"),
		TEXT("{\"type\":\"set\",\"id\":\"p1\",\"control\":\"ammo\",\"value\":\"11\"}"),
		TEXT("{\"type\":\"set\",\"control\":\"shield\",\"value\":true}"),
	};
	if (TestEqual(TEXT("messages sent"), Sent.Num(), (int32)UE_ARRAY_COUNT(Expected)))
	{
		for (int32 i = 0; i < Sent.Num(); ++i)
		{
			PhoneWandTests::ExpectJson(*this, FString::Printf(TEXT("message %d"), i + 1), Sent[i], Expected[i]);
		}
	}
	// A choice's index is a whole number on the wire.
	if (Sent.Num() > 9)
	{
		const TSharedPtr<FJsonValue> Set = PhoneWandTests::ParseValue(Sent[9]);
		TestTrue(TEXT("choice index is an integer"), Set.IsValid() && FMath::IsNearlyEqual(Set->AsObject()->GetNumberField(TEXT("value")), 2.0));
	}

	// Reading a layout back gives the same layout, and the same JSON again.
	for (const FPhoneWandLayout& Layout : { Shooter, Grid, Crawler, Rows, Columns, PhoneWand::DefaultLayout() })
	{
		const FString Json = UPhoneWandLibrary::LayoutToJson(Layout);
		const TSharedPtr<FJsonValue> Parsed = PhoneWandTests::ParseValue(Json);
		if (TestTrue(TEXT("layout JSON parses"), Parsed.IsValid() && Parsed->Type == EJson::Object))
		{
			const FPhoneWandLayout Back = PhoneWand::LayoutFromJson(*Parsed->AsObject());
			TestEqual(TEXT("round trip template"), Back.Template, Layout.Template);
			TestEqual(TEXT("round trip control count"), Back.Controls.Num(), Layout.Controls.Num());
			PhoneWandTests::ExpectJson(*this, TEXT("round trip"), UPhoneWandLibrary::LayoutToJson(Back), Json);
		}
	}
	PhoneWandTests::ExpectJson(*this, TEXT("default layout"), UPhoneWandLibrary::LayoutToJson(PhoneWand::DefaultLayout()),
		TEXT("{\"template\":\"primary-secondary\",\"controls\":[{\"id\":\"primary\",\"type\":\"button\",\"label\":\"Primary\"},{\"id\":\"secondary\",\"type\":\"button\",\"label\":\"Secondary\"}]}"));

	TestEqual(TEXT("primary constant"), UPhoneWandLibrary::PrimaryButton(), FString(TEXT("primary")));
	TestEqual(TEXT("secondary constant"), UPhoneWandLibrary::SecondaryButton(), FString(TEXT("secondary")));
	TestEqual(TEXT("template names"), UPhoneWandLibrary::TemplateToString(EPhoneWandTemplate::PrimaryRow), FString(TEXT("primary-row")));
	TestEqual(TEXT("rows template name"), UPhoneWandLibrary::TemplateToString(EPhoneWandTemplate::Rows), FString(TEXT("rows")));
	TestEqual(TEXT("columns template name"), UPhoneWandLibrary::TemplateToString(EPhoneWandTemplate::Columns), FString(TEXT("columns")));
	TestEqual(TEXT("value to string"), UPhoneWandLibrary::ControlValueToString(UPhoneWandLibrary::MakeControlNumber(0.8)), FString(TEXT("0.8")));

	// Each arrow or key of a dpad or crawl is a button named <id>.<direction>.
	const TArray<FString> Dpad = {
		UPhoneWandLibrary::DpadButton(TEXT("move"), EPhoneWandDpadDirection::Up),
		UPhoneWandLibrary::DpadButton(TEXT("move"), EPhoneWandDpadDirection::Down),
		UPhoneWandLibrary::DpadButton(TEXT("move"), EPhoneWandDpadDirection::Left),
		UPhoneWandLibrary::DpadButton(TEXT("move"), EPhoneWandDpadDirection::Right),
	};
	TestEqual(TEXT("dpad buttons"), Dpad, TArray<FString>({ TEXT("move.up"), TEXT("move.down"), TEXT("move.left"), TEXT("move.right") }));
	const TArray<FString> Crawl = {
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::Forward),
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::Back),
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::StepLeft),
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::StepRight),
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::TurnLeft),
		UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::TurnRight),
	};
	TestEqual(TEXT("crawl buttons"), Crawl, TArray<FString>({ TEXT("walk.forward"), TEXT("walk.back"), TEXT("walk.step-left"), TEXT("walk.step-right"), TEXT("walk.turn-left"), TEXT("walk.turn-right") }));
	return !HasAnyErrors();
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandLayoutClientTest, "PhoneWand.Layouts.Client", PhoneWandTests::Flags)

bool FPhoneWandLayoutClientTest::RunTest(const FString& Parameters)
{
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FString> Changes;
	Wand->OnControlChangedNative.AddLambda([&Changes](const FPhoneWandPlayer& P, const FString& Control, const FPhoneWandControlValue& Value)
	{
		// The player passed in already holds the new value.
		Changes.Add(FString::Printf(TEXT("%s %s=%s held=%s"), *P.Id, *Control, *Value.ToString(), *P.GetControl(Control).ToString()));
	});

	// A relay that predates layouts sends no layout: the player gets the default.
	Wand->HandleMessage(TEXT("{\"type\":\"hello\",\"protocol\":0,\"maxPlayers\":4,\"players\":[{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"colour\":\"#ff4d6d\",\"state\":\"active\"}]}"));
	FPhoneWandPlayer P;
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("default template"), P.Layout.Template, EPhoneWandTemplate::PrimarySecondary);
	TestTrue(TEXT("default controls"), P.Layout.Controls.Num() == 2 && P.Layout.Controls[0].Id == TEXT("primary") && P.Layout.Controls[1].Id == TEXT("secondary"));

	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"state\":\"active\",")
		TEXT("\"layout\":{\"template\":\"grid\",\"controls\":[{\"id\":\"fire\",\"type\":\"button\",\"colour\":\"#00ff88\"},{\"id\":\"power\",\"type\":\"slider\",\"value\":0.25,\"orientation\":\"vertical\",\"spring\":0.5},")
		TEXT("{\"id\":\"weapon\",\"type\":\"choice\",\"options\":[\"Bow\",\"Sling\"],\"value\":1},{\"id\":\"future\",\"type\":\"dial\"}]},")
		TEXT("\"controls\":{\"power\":0.25,\"weapon\":1}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("grid"), P.Layout.Template, EPhoneWandTemplate::Grid);
	TestEqual(TEXT("unknown control type skipped"), P.Layout.Controls.Num(), 3);
	if (const FPhoneWandControl* Power = P.Layout.FindControl(TEXT("power")))
	{
		TestEqual(TEXT("slider type"), Power->Type, EPhoneWandControlType::Slider);
		TestTrue(TEXT("slider vertical, springs to 0.5"), Power->bVertical && Power->bSpring && FMath::IsNearlyEqual(Power->Spring, 0.5));
	}
	else
	{
		AddError(TEXT("no power control"));
	}
	TestTrue(TEXT("button colour"), P.Layout.Controls[0].bHasColour && UPhoneWandLibrary::ColourToHex(P.Layout.Controls[0].Colour) == TEXT("#00ff88"));
	TestEqual(TEXT("two values"), P.Controls.Num(), 2);
	TestEqual(TEXT("weapon index"), P.GetControl(TEXT("weapon")).Index, 1);

	Wand->HandleMessage(TEXT("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"fire\",\"down\":true}"));
	TestTrue(TEXT("custom button held"), Wand->IsButtonHeld(TEXT("p1"), TEXT("fire")));
	Wand->HandleMessage(TEXT("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"power\",\"value\":0.8}"));
	Wand->HandleMessage(TEXT("{\"type\":\"control\",\"id\":\"p1\",\"control\":\"weapon\",\"value\":0}"));
	Wand->HandleMessage(TEXT("{\"type\":\"control\",\"id\":\"nobody\",\"control\":\"power\",\"value\":1}"));
	TestEqual(TEXT("control events"), Changes, TArray<FString>({ TEXT("p1 power=0.8 held=0.8"), TEXT("p1 weapon=0 held=0") }));
	FPhoneWandControlValue V;
	TestTrue(TEXT("GetControlValue"), Wand->GetControlValue(TEXT("p1"), TEXT("power"), V) && V.Type == EPhoneWandValueType::Number && FMath::IsNearlyEqual(V.Number, 0.8));
	TestFalse(TEXT("GetControlValue for a button"), Wand->GetControlValue(TEXT("p1"), TEXT("fire"), V));

	// A partial player message leaves the layout alone; one with a layout replaces layout and values.
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"name\":\"B\"}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("partial keeps layout"), P.Layout.Template, EPhoneWandTemplate::Grid);
	TestEqual(TEXT("partial keeps values"), P.Controls.Num(), 2);
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":{\"template\":\"primary\",\"controls\":[{\"id\":\"go\",\"type\":\"button\"}]},\"controls\":{}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("replaced template"), P.Layout.Template, EPhoneWandTemplate::Primary);
	TestEqual(TEXT("replaced values"), P.Controls.Num(), 0);
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":null}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("null layout is the default"), P.Layout.Template, EPhoneWandTemplate::PrimarySecondary);

	// Dpad and crawl controls are kept; their directions are ordinary buttons.
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":{\"template\":\"primary-row\",\"controls\":[")
		TEXT("{\"id\":\"walk\",\"label\":\"Walk\",\"type\":\"crawl\"},{\"id\":\"use\",\"type\":\"button\"}]},\"controls\":{}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestTrue(TEXT("crawl kept"), P.Layout.Controls.Num() == 2 && P.Layout.Controls[0].Type == EPhoneWandControlType::Crawl
		&& P.Layout.Controls[0].Label == TEXT("Walk") && P.Layout.Controls[1].Type == EPhoneWandControlType::Button);
	TestEqual(TEXT("crawl has no value"), P.Controls.Num(), 0);
	Wand->HandleMessage(TEXT("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"walk.turn-left\",\"down\":true}"));
	TestTrue(TEXT("crawl key held"), Wand->IsButtonHeld(TEXT("p1"), UPhoneWandLibrary::CrawlButton(TEXT("walk"), EPhoneWandCrawlDirection::TurnLeft)));
	Wand->HandleMessage(TEXT("{\"type\":\"button\",\"id\":\"p1\",\"button\":\"walk.turn-left\",\"down\":false}"));
	TestFalse(TEXT("crawl key released"), Wand->IsButtonHeld(TEXT("p1"), TEXT("walk.turn-left")));
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":{\"template\":\"pair\",\"controls\":[")
		TEXT("{\"id\":\"move\",\"type\":\"dpad\"},{\"id\":\"a\",\"type\":\"button\"}]},\"controls\":{}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestTrue(TEXT("dpad kept"), P.Layout.Controls.Num() == 2 && P.Layout.Controls[0].Type == EPhoneWandControlType::Dpad);
	TestEqual(TEXT("dpad has no value"), P.Controls.Num(), 0);

	// Rows and columns come back with their counts and sizes (sizes only when the relay sent them).
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":{\"template\":\"rows\",\"rows\":[1,2],\"heights\":[3,0.5],\"controls\":[")
		TEXT("{\"id\":\"walk\",\"type\":\"crawl\"},{\"id\":\"use\",\"type\":\"button\"},{\"id\":\"map\",\"type\":\"toggle\",\"value\":true}]},\"controls\":{\"map\":true}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("rows template"), P.Layout.Template, EPhoneWandTemplate::Rows);
	TestEqual(TEXT("rows counts"), P.Layout.Counts, TArray<int32>({ 1, 2 }));
	TestTrue(TEXT("rows heights"), P.Layout.Sizes.Num() == 2 && FMath::IsNearlyEqual(P.Layout.Sizes[0], 3.0) && FMath::IsNearlyEqual(P.Layout.Sizes[1], 0.5));
	TestTrue(TEXT("rows controls"), P.Layout.Controls.Num() == 3 && P.Layout.Controls[0].Type == EPhoneWandControlType::Crawl);
	TestEqual(TEXT("rows values"), P.Controls.Num(), 1);
	Wand->HandleMessage(TEXT("{\"type\":\"player\",\"player\":{\"id\":\"p1\",\"layout\":{\"template\":\"columns\",\"columns\":[2],\"controls\":[")
		TEXT("{\"id\":\"a\",\"type\":\"button\"},{\"id\":\"b\",\"type\":\"button\"}]},\"controls\":{}}}"));
	Wand->GetPlayer(TEXT("p1"), P);
	TestEqual(TEXT("columns template"), P.Layout.Template, EPhoneWandTemplate::Columns);
	TestEqual(TEXT("columns counts"), P.Layout.Counts, TArray<int32>({ 2 }));
	TestEqual(TEXT("columns without widths"), P.Layout.Sizes.Num(), 0);

	// error: a warning when nothing is bound, the delegate otherwise.
	AddExpectedMessagePlain(TEXT("layout: template grid holds at most 6 controls"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	Wand->HandleMessage(TEXT("{\"type\":\"error\",\"message\":\"layout: template grid holds at most 6 controls\"}"));
	TArray<FString> Errors;
	Wand->OnRelayErrorNative.AddLambda([&Errors](const FString& Message) { Errors.Add(Message); });
	Wand->HandleMessage(TEXT("{\"type\":\"error\",\"message\":\"set: p1 has no control x that takes 1\"}"));
	TestEqual(TEXT("error delegate"), Errors, TArray<FString>({ TEXT("set: p1 has no control x that takes 1") }));
	return !HasAnyErrors();
}

// ---------------------------------------------------------------------- live relay

namespace PhoneWandTests
{
	struct FLiveState
	{
		TStrongObjectPtr<UPhoneWandSubsystem> Wand;
		double Start = 0.0;
		int32 Connected = 0;
		int32 Joins = 0;
		int32 Poses = 0;
		int32 PosesOnScreen = 0;
		int32 Buttons = 0;
		int32 Stats = 0;
	};
}

DEFINE_LATENT_AUTOMATION_COMMAND_TWO_PARAMETER(FPhoneWandWaitForLive, TSharedPtr<PhoneWandTests::FLiveState>, State, FAutomationTestBase*, Test);

bool FPhoneWandWaitForLive::Update()
{
	const double Elapsed = FPlatformTime::Seconds() - State->Start;
	const bool bSeenEnough = State->Connected > 0 && State->Joins > 0 && State->Poses > 0 && State->Stats > 0;
	if (!(bSeenEnough && Elapsed >= 3.0) && Elapsed < 15.0)
	{
		return false; // keep ticking
	}
	Test->AddInfo(FString::Printf(TEXT("After %.1f s: connected=%d joins=%d poses=%d (on screen %d) buttons=%d stats=%d players=%d"),
		Elapsed, State->Connected, State->Joins, State->Poses, State->PosesOnScreen, State->Buttons, State->Stats, State->Wand->GetPlayerCount()));
	Test->TestTrue(TEXT("saw connected"), State->Connected > 0);
	Test->TestTrue(TEXT("saw joins"), State->Joins > 0);
	Test->TestTrue(TEXT("saw poses"), State->Poses > 0);
	Test->TestTrue(TEXT("saw stats"), State->Stats > 0);
	for (const FPhoneWandPlayer& P : State->Wand->GetPlayers())
	{
		Test->AddInfo(FString::Printf(TEXT("  slot %d %s \"%s\" %s %s screen=(%.3f, %.3f) dir=%s"), P.Slot, *P.Id, *P.Name, *P.Colour,
			*PhoneWand::ToString(P.State), P.Pose.Screen.X, P.Pose.Screen.Y, *P.Pose.Direction.ToString()));
	}
	State->Wand->Disconnect();
	State->Wand.Reset();
	return true;
}

// ---------------------------------------------------------------------- gestures

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandGestureConfigureTest, "PhoneWand.Gestures.Configure", PhoneWandTests::Flags)

bool FPhoneWandGestureConfigureTest::RunTest(const FString& Parameters)
{
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FString> Sent;
	Wand->SetSendOverride([&Sent](const FString& Json) { Sent.Add(Json); });

	// Nothing changed: nothing to send, so the relay keeps its defaults.
	TestEqual(TEXT("default configure is empty"), Wand->GetConfigureJson(), FString());
	TestTrue(TEXT("gestures on by default"), Wand->AreGesturesEnabled());

	Wand->SetGestureSensitivity(9.0, 0.5, 400.0);
	Wand->SetGesturesEnabled(false);
	Wand->SetSmoothing(1.5f, 4.0f, 1.0f);
	Wand->SetGesturesEnabled(true);
	Wand->SetRaw();
	TestTrue(TEXT("gestures on again"), Wand->AreGesturesEnabled());

	const TCHAR* Expected[] = {
		TEXT("{\"type\":\"configure\",\"gestures\":{\"threshold\":9,\"minSpeed\":0.5,\"flickRate\":250,\"twistRate\":400}}"),
		TEXT("{\"type\":\"configure\",\"gestures\":false}"),
		TEXT("{\"type\":\"configure\",\"smoothing\":{\"minCutoff\":1.5,\"beta\":4,\"dCutoff\":1},\"gestures\":false}"),
		TEXT("{\"type\":\"configure\",\"smoothing\":{\"minCutoff\":1.5,\"beta\":4,\"dCutoff\":1},\"gestures\":{\"threshold\":9,\"minSpeed\":0.5,\"flickRate\":250,\"twistRate\":400}}"),
		TEXT("{\"type\":\"configure\",\"smoothing\":false,\"gestures\":{\"threshold\":9,\"minSpeed\":0.5,\"flickRate\":250,\"twistRate\":400}}"),
	};
	if (TestEqual(TEXT("messages sent"), Sent.Num(), (int32)UE_ARRAY_COUNT(Expected)))
	{
		for (int32 i = 0; i < Sent.Num(); ++i)
		{
			PhoneWandTests::ExpectJson(*this, FString::Printf(TEXT("message %d"), i + 1), Sent[i], Expected[i]);
		}
	}
	// What a reconnect sends: the latest of both settings.
	PhoneWandTests::ExpectJson(*this, TEXT("configure on connect"), Wand->GetConfigureJson(), Expected[4]);

	// Gestures alone, smoothing left to the relay.
	TStrongObjectPtr<UPhoneWandSubsystem> Other = PhoneWandTests::MakeWand();
	Other->SetGesturesEnabled(false);
	PhoneWandTests::ExpectJson(*this, TEXT("gestures off only"), Other->GetConfigureJson(), TEXT("{\"type\":\"configure\",\"gestures\":false}"));

	TestEqual(TEXT("default threshold"), PhoneWand::DefaultGestureThreshold, 7.0);
	TestEqual(TEXT("default min speed"), PhoneWand::DefaultGestureMinSpeed, 0.35);
	TestEqual(TEXT("default twist rate"), PhoneWand::DefaultGestureTwistRate, 360.0);
	return !HasAnyErrors();
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandGestureClientTest, "PhoneWand.Gestures.Client", PhoneWandTests::Flags)

bool FPhoneWandGestureClientTest::RunTest(const FString& Parameters)
{
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	TArray<FPhoneWandGesture> Gestures;
	Wand->OnGestureNative.AddLambda([&Gestures](const FPhoneWandPlayer& P, const FPhoneWandGesture& G) { Gestures.Add(G); });

	Wand->HandleMessage(TEXT("{\"type\":\"hello\",\"protocol\":0,\"maxPlayers\":4,\"players\":[{\"id\":\"p1\",\"slot\":0,\"name\":\"A\",\"colour\":\"#ff4d6d\",\"state\":\"active\"}]}"));
	Wand->HandleMessage(TEXT("{\"type\":\"gesture\",\"id\":\"p1\",\"gesture\":\"pull\",\"strength\":0.62,\"speed\":1.55,\"dir\":[0.05,-0.1,-0.99],\"duration\":240,\"t\":1790300000123.4,\"buttons\":[\"secondary\",\"primary\"]}"));
	Wand->HandleMessage(TEXT("{\"type\":\"gesture\",\"id\":\"p1\",\"gesture\":\"twist-left\",\"strength\":0.5,\"speed\":0,\"dir\":[0,0,0],\"duration\":150,\"t\":5,\"buttons\":[]}"));
	Wand->HandleMessage(TEXT("{\"type\":\"gesture\",\"id\":\"p1\",\"gesture\":\"loop-the-loop\",\"strength\":1,\"speed\":2,\"dir\":[0,1,0],\"duration\":400,\"t\":6,\"buttons\":[]}"));
	// An unknown player fires nothing.
	Wand->HandleMessage(TEXT("{\"type\":\"gesture\",\"id\":\"p9\",\"gesture\":\"push\",\"strength\":1,\"speed\":1,\"dir\":[0,0,1],\"duration\":200,\"t\":7,\"buttons\":[]}"));

	if (TestEqual(TEXT("gestures fired"), Gestures.Num(), 3))
	{
		const FPhoneWandGesture& Pull = Gestures[0];
		TestEqual(TEXT("player id"), Pull.Id, FString(TEXT("p1")));
		TestEqual(TEXT("pull"), Pull.Gesture, EPhoneWandGesture::Pull);
		TestEqual(TEXT("pull name"), Pull.GestureName, FString(TEXT("pull")));
		TestEqual(TEXT("strength"), Pull.Strength, 0.62, 1e-9);
		TestEqual(TEXT("speed"), Pull.Speed, 1.55, 1e-9);
		TestEqual(TEXT("duration"), Pull.Duration, 240.0, 1e-9);
		TestEqual(TEXT("time keeps double precision"), Pull.Time, 1790300000123.4, 1e-3);
		TestTrue(TEXT("raw direction"), PhoneWandTests::Near(Pull.RawDirection, FVector(0.05, -0.1, -0.99)));
		TestTrue(TEXT("direction in Unreal's frame"), PhoneWandTests::Near(Pull.Direction, FVector(-0.99, 0.05, -0.1)));
		TestEqual(TEXT("buttons sorted"), FString::Join(Pull.Buttons, TEXT(",")), FString(TEXT("primary,secondary")));
		TestTrue(TEXT("primary held"), UPhoneWandLibrary::IsGestureButtonHeld(Pull, TEXT("primary")));
		TestFalse(TEXT("other not held"), Pull.IsButtonHeld(TEXT("fire")));

		TestEqual(TEXT("twist-left"), Gestures[1].Gesture, EPhoneWandGesture::TwistLeft);
		TestTrue(TEXT("twist has no direction"), Gestures[1].Direction.IsZero());
		TestFalse(TEXT("nothing held"), Gestures[1].IsButtonHeld(TEXT("primary")));

		TestEqual(TEXT("unknown gesture"), Gestures[2].Gesture, EPhoneWandGesture::Unknown);
		TestEqual(TEXT("unknown keeps its name"), Gestures[2].GestureName, FString(TEXT("loop-the-loop")));
	}

	// Every name round-trips.
	for (const TCHAR* Name : { TEXT("push"), TEXT("pull"), TEXT("left"), TEXT("right"), TEXT("up"), TEXT("down"), TEXT("shake"), TEXT("twist-left"), TEXT("twist-right"), TEXT("flick-up"), TEXT("flick-down"), TEXT("flick-left"), TEXT("flick-right") })
	{
		const EPhoneWandGesture G = PhoneWand::ParseGesture(Name);
		TestNotEqual(FString::Printf(TEXT("%s is known"), Name), G, EPhoneWandGesture::Unknown);
		TestEqual(FString::Printf(TEXT("%s round trip"), Name), UPhoneWandLibrary::GestureToString(G), FString(Name));
	}
	TestEqual(TEXT("Unknown has no name"), PhoneWand::ToString(EPhoneWandGesture::Unknown), FString());

	// Pose acceleration, converted to Unreal's frame; absent when the phone sends none.
	Wand->HandleMessage(TEXT("{\"type\":\"pose\",\"id\":\"p1\",\"seq\":1,\"t\":1,\"q\":[0,0,0,1],\"yaw\":0,\"pitch\":0,\"roll\":0,\"dir\":[0,0,1],\"screen\":null,\"accel\":[1,2,3]}"));
	FPhoneWandPlayer P;
	if (TestTrue(TEXT("player exists"), Wand->GetPlayer(TEXT("p1"), P)))
	{
		TestTrue(TEXT("has accel"), P.Pose.bHasAccel);
		TestTrue(TEXT("rig accel"), PhoneWandTests::Near(P.Pose.RigAccel, FVector(1, 2, 3)));
		TestTrue(TEXT("accel in Unreal's frame"), PhoneWandTests::Near(P.Pose.Accel, FVector(3, 1, 2)));
	}
	Wand->HandleMessage(TEXT("{\"type\":\"pose\",\"id\":\"p1\",\"seq\":2,\"t\":2,\"q\":[0,0,0,1],\"yaw\":0,\"pitch\":0,\"roll\":0,\"dir\":[0,0,1],\"screen\":null}"));
	if (Wand->GetPlayer(TEXT("p1"), P))
	{
		TestFalse(TEXT("no accel"), P.Pose.bHasAccel);
		TestTrue(TEXT("accel zero"), P.Pose.Accel.IsZero());
	}
	return !HasAnyErrors();
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandLiveTest, "PhoneWand.Live.Relay", PhoneWandTests::Flags)

bool FPhoneWandLiveTest::RunTest(const FString& Parameters)
{
	FString Url = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_LIVE_URL"));
	if (Url.IsEmpty())
	{
		FParse::Value(FCommandLine::Get(), TEXT("PhoneWandLiveUrl="), Url);
	}
	if (Url.IsEmpty())
	{
		AddInfo(TEXT("Skipped: set PHONEWAND_LIVE_URL (for example ws://127.0.0.1:8480/app) to run against a relay."));
		return true;
	}

	TSharedPtr<PhoneWandTests::FLiveState> State = MakeShared<PhoneWandTests::FLiveState>();
	State->Wand = PhoneWandTests::MakeWand();
	UPhoneWandSubsystem* Wand = State->Wand.Get();
	PhoneWandTests::FLiveState* S = State.Get();
	Wand->OnConnectedNative.AddLambda([S](const FPhoneWandHello& H) { ++S->Connected; });
	Wand->OnPlayerJoinedNative.AddLambda([S](const FPhoneWandPlayer&) { ++S->Joins; });
	Wand->OnPoseNative.AddLambda([S](const FPhoneWandPlayer&, const FPhoneWandPose& Pose) { ++S->Poses; if (UPhoneWandLibrary::IsOnScreen(Pose)) ++S->PosesOnScreen; });
	Wand->OnButtonNative.AddLambda([S](const FPhoneWandPlayer&, const FString&, bool) { ++S->Buttons; });
	Wand->OnStatsNative.AddLambda([S](const FPhoneWandPlayer&, const FPhoneWandStats&) { ++S->Stats; });
	State->Start = FPlatformTime::Seconds();
	AddInfo(FString::Printf(TEXT("Connecting to %s"), *Url));
	Wand->Connect(Url);
	Wand->Prompt(TEXT("ignored: not connected yet"));

	ADD_LATENT_AUTOMATION_COMMAND(FPhoneWandWaitForLive(State, this));
	return true;
}

// ---------------------------------------------------------------------- live layouts
//
// Needs a relay and a phone that reacts to layouts, such as clients/unreal/Scripts/fake-phone.ts:
// when its layout gains a "fire" button it presses and releases it and moves the "power" slider
// to 0.7. The test sends that layout, waits for the button and control events, sets a label,
// sends an invalid layout (which must fire OnRelayError) and finally goes back to the default.

namespace PhoneWandTests
{
	struct FLayoutLiveState
	{
		TStrongObjectPtr<UPhoneWandSubsystem> Wand;
		FString PlayerId;
		int32 Phase = 0;
		double PhaseStart = 0.0;
		TArray<FString> Buttons;
		TArray<FString> Controls;
		TArray<FString> Errors;
		TArray<FString> Templates;

		void NextPhase(int32 P) { Phase = P; PhaseStart = FPlatformTime::Seconds(); }
		double InPhase() const { return FPlatformTime::Seconds() - PhaseStart; }
	};

	FPhoneWandLayout LiveLayout()
	{
		return UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::Grid, {
			UPhoneWandLibrary::MakeButton(TEXT("fire"), TEXT("Fire")),
			UPhoneWandLibrary::MakeSlider(TEXT("power"), TEXT("Power")),
			UPhoneWandLibrary::MakeToggle(TEXT("shield"), TEXT("Shield")),
			UPhoneWandLibrary::MakeLabel(TEXT("score"), TEXT("Score"), TEXT("0")),
		});
	}
}

DEFINE_LATENT_AUTOMATION_COMMAND_TWO_PARAMETER(FPhoneWandLayoutLiveSteps, TSharedPtr<PhoneWandTests::FLayoutLiveState>, State, FAutomationTestBase*, Test);

bool FPhoneWandLayoutLiveSteps::Update()
{
	PhoneWandTests::FLayoutLiveState& S = *State;
	UPhoneWandSubsystem* Wand = S.Wand.Get();
	auto Finish = [&S, Wand]()
	{
		Wand->Disconnect();
		S.Wand.Reset();
		return true;
	};
	auto TimedOut = [&S, this, &Finish](double Seconds, const TCHAR* What)
	{
		if (S.InPhase() < Seconds)
		{
			return false;
		}
		Test->AddError(FString::Printf(TEXT("Timed out after %.0f s waiting for %s (buttons: %s; controls: %s; errors: %s; templates: %s)"), Seconds, What,
			*FString::Join(S.Buttons, TEXT(", ")), *FString::Join(S.Controls, TEXT(", ")), *FString::Join(S.Errors, TEXT(", ")), *FString::Join(S.Templates, TEXT(", "))));
		return true;
	};

	switch (S.Phase)
	{
	case 0: // an active player
	{
		for (const FPhoneWandPlayer& P : Wand->GetPlayers())
		{
			if (P.State == EPhoneWandPlayerState::Active)
			{
				S.PlayerId = P.Id;
			}
		}
		if (S.PlayerId.IsEmpty())
		{
			return TimedOut(20.0, TEXT("a connected, active phone")) ? Finish() : false;
		}
		Test->AddInfo(FString::Printf(TEXT("Player %s is active; sending the layout to every phone"), *S.PlayerId));
		Wand->SetLayout(PhoneWandTests::LiveLayout());
		S.NextPhase(1);
		return false;
	}
	case 1: // the layout arrives back as a player message; the phone presses fire and moves power
	{
		FPhoneWandPlayer P;
		Wand->GetPlayer(S.PlayerId, P);
		const bool bDone = P.Layout.Template == EPhoneWandTemplate::Grid && S.Buttons.Contains(TEXT("fire down")) && S.Buttons.Contains(TEXT("fire up"))
			&& S.Controls.Contains(TEXT("power=0.7"));
		if (!bDone)
		{
			return TimedOut(15.0, TEXT("the layout, the fire button and the power slider")) ? Finish() : false;
		}
		Test->TestEqual(TEXT("layout held: 4 controls"), P.Layout.Controls.Num(), 4);
		Test->TestTrue(TEXT("power held at 0.7"), P.GetControl(TEXT("power")).Type == EPhoneWandValueType::Number && FMath::IsNearlyEqual(P.GetControl(TEXT("power")).Number, 0.7, 1e-6));
		Test->TestTrue(TEXT("shield held, off"), P.GetControl(TEXT("shield")).Type == EPhoneWandValueType::Bool && !P.GetControl(TEXT("shield")).bValue);
		Test->TestFalse(TEXT("fire released"), P.IsButtonHeld(TEXT("fire")));
		Test->AddInfo(FString::Printf(TEXT("Layout applied; buttons: %s; controls: %s"), *FString::Join(S.Buttons, TEXT(", ")), *FString::Join(S.Controls, TEXT(", "))));
		Wand->SetControlText(TEXT("score"), TEXT("42"), S.PlayerId);
		S.NextPhase(2);
		return false;
	}
	case 2: // setting a label comes back as a control event
	{
		if (!S.Controls.Contains(TEXT("score=42")))
		{
			return TimedOut(10.0, TEXT("the score label change")) ? Finish() : false;
		}
		FPhoneWandControlValue V;
		Test->TestTrue(TEXT("score held"), Wand->GetControlValue(S.PlayerId, TEXT("score"), V) && V.Type == EPhoneWandValueType::Text && V.Text == TEXT("42"));
		// Invalid: the first control of a primary template must be a button, dpad or crawl.
		Wand->SetLayout(UPhoneWandLibrary::MakeLayout(EPhoneWandTemplate::Primary, { UPhoneWandLibrary::MakeToggle(TEXT("nope")) }), S.PlayerId);
		S.NextPhase(3);
		return false;
	}
	case 3: // the invalid layout fires OnRelayError and changes nothing
	{
		if (S.Errors.Num() == 0)
		{
			return TimedOut(10.0, TEXT("OnRelayError for an invalid layout")) ? Finish() : false;
		}
		Test->AddInfo(FString::Printf(TEXT("OnRelayError: %s"), *S.Errors[0]));
		Test->TestTrue(TEXT("error names the problem"), S.Errors[0].Contains(TEXT("must be a button")));
		FPhoneWandPlayer P;
		Wand->GetPlayer(S.PlayerId, P);
		Test->TestEqual(TEXT("invalid layout changed nothing"), P.Layout.Template, EPhoneWandTemplate::Grid);
		Wand->ResetLayout();
		S.NextPhase(4);
		return false;
	}
	case 4: // back to the default
	{
		FPhoneWandPlayer P;
		Wand->GetPlayer(S.PlayerId, P);
		if (P.Layout.Template != EPhoneWandTemplate::PrimarySecondary)
		{
			return TimedOut(10.0, TEXT("the default layout")) ? Finish() : false;
		}
		Test->TestTrue(TEXT("default buttons"), P.Layout.Controls.Num() == 2 && P.Layout.Controls[0].Id == TEXT("primary"));
		Test->TestEqual(TEXT("default has no values"), P.Controls.Num(), 0);
		Test->AddInfo(FString::Printf(TEXT("Back to the default layout. Templates seen: %s"), *FString::Join(S.Templates, TEXT(", "))));
		return Finish();
	}
	default:
		return Finish();
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandLayoutLiveTest, "PhoneWand.Live.Layouts", PhoneWandTests::Flags)

bool FPhoneWandLayoutLiveTest::RunTest(const FString& Parameters)
{
	FString Url = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_LAYOUT_LIVE_URL"));
	if (Url.IsEmpty())
	{
		FParse::Value(FCommandLine::Get(), TEXT("PhoneWandLayoutLiveUrl="), Url);
	}
	if (Url.IsEmpty())
	{
		AddInfo(TEXT("Skipped: set PHONEWAND_LAYOUT_LIVE_URL to a relay's app URL, with a phone that reacts to layouts connected (clients/unreal/Scripts/fake-phone.ts)."));
		return true;
	}

	TSharedPtr<PhoneWandTests::FLayoutLiveState> State = MakeShared<PhoneWandTests::FLayoutLiveState>();
	State->Wand = PhoneWandTests::MakeWand();
	UPhoneWandSubsystem* Wand = State->Wand.Get();
	PhoneWandTests::FLayoutLiveState* S = State.Get();
	Wand->OnButtonNative.AddLambda([S](const FPhoneWandPlayer&, const FString& Button, bool bDown)
	{
		S->Buttons.Add(Button + (bDown ? TEXT(" down") : TEXT(" up")));
	});
	Wand->OnControlChangedNative.AddLambda([S](const FPhoneWandPlayer& P, const FString& Control, const FPhoneWandControlValue& Value)
	{
		// Rounded, so 0.7 sent by the phone reads as 0.7.
		const FString Shown = Value.Type == EPhoneWandValueType::Number ? FString::Printf(TEXT("%g"), FMath::RoundToDouble(Value.Number * 1000.0) / 1000.0) : Value.ToString();
		S->Controls.Add(Control + TEXT("=") + Shown);
	});
	Wand->OnRelayErrorNative.AddLambda([S](const FString& Message) { S->Errors.Add(Message); });
	Wand->OnPlayerChangedNative.AddLambda([S](const FPhoneWandPlayer& P)
	{
		const FString Name = PhoneWand::ToString(P.Layout.Template);
		if (S->Templates.Num() == 0 || S->Templates.Last() != Name)
		{
			S->Templates.Add(Name);
		}
	});
	AddInfo(FString::Printf(TEXT("Connecting to %s"), *Url));
	State->NextPhase(0);
	Wand->Connect(Url);
	ADD_LATENT_AUTOMATION_COMMAND(FPhoneWandLayoutLiveSteps(State, this));
	return true;
}

// ---------------------------------------------------------------------- live gestures
//
// Needs a relay and a phone that flicks, such as clients/unreal/Scripts/gesture-phone.ts: it
// pushes the phone towards the screen every 1.5 s while holding Primary. The test sets the
// sensitivity (so a configure with gestures goes over the wire) and waits for a push with
// "primary" held, plus poses carrying acceleration.

namespace PhoneWandTests
{
	struct FGestureLiveState
	{
		TStrongObjectPtr<UPhoneWandSubsystem> Wand;
		double Start = 0.0;
		int32 AccelPoses = 0;
		TArray<FString> Gestures;
		bool bGotHeldPush = false;
	};
}

DEFINE_LATENT_AUTOMATION_COMMAND_TWO_PARAMETER(FPhoneWandGestureLiveWait, TSharedPtr<PhoneWandTests::FGestureLiveState>, State, FAutomationTestBase*, Test);

bool FPhoneWandGestureLiveWait::Update()
{
	PhoneWandTests::FGestureLiveState& S = *State;
	const bool bTimedOut = FPlatformTime::Seconds() - S.Start > 30.0;
	if (!S.bGotHeldPush && !bTimedOut)
	{
		return false;
	}
	if (S.bGotHeldPush)
	{
		Test->AddInfo(FString::Printf(TEXT("Gestures: %s; poses with acceleration: %d"), *FString::Join(S.Gestures, TEXT("; ")), S.AccelPoses));
		Test->TestTrue(TEXT("poses carry acceleration"), S.AccelPoses > 0);
	}
	else
	{
		Test->AddError(FString::Printf(TEXT("Timed out after 30 s waiting for a push with primary held (gestures: %s; poses with acceleration: %d)"),
			*FString::Join(S.Gestures, TEXT("; ")), S.AccelPoses));
	}
	S.Wand->Disconnect();
	S.Wand.Reset();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandGestureLiveTest, "PhoneWand.Live.Gestures", PhoneWandTests::Flags)

bool FPhoneWandGestureLiveTest::RunTest(const FString& Parameters)
{
	FString Url = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_GESTURE_LIVE_URL"));
	if (Url.IsEmpty())
	{
		FParse::Value(FCommandLine::Get(), TEXT("PhoneWandGestureLiveUrl="), Url);
	}
	if (Url.IsEmpty())
	{
		AddInfo(TEXT("Skipped: set PHONEWAND_GESTURE_LIVE_URL to a relay's app URL, with a flicking phone connected (clients/unreal/Scripts/gesture-phone.ts)."));
		return true;
	}

	TSharedPtr<PhoneWandTests::FGestureLiveState> State = MakeShared<PhoneWandTests::FGestureLiveState>();
	State->Wand = PhoneWandTests::MakeWand();
	UPhoneWandSubsystem* Wand = State->Wand.Get();
	PhoneWandTests::FGestureLiveState* S = State.Get();
	Wand->OnPoseNative.AddLambda([S](const FPhoneWandPlayer&, const FPhoneWandPose& Pose)
	{
		if (Pose.bHasAccel)
		{
			++S->AccelPoses;
		}
	});
	Wand->OnGestureNative.AddLambda([S](const FPhoneWandPlayer& P, const FPhoneWandGesture& G)
	{
		S->Gestures.Add(FString::Printf(TEXT("%s %s strength=%.2f dir=(%.2f, %.2f, %.2f) buttons=%s"), *P.Id, *G.GestureName, G.Strength,
			G.Direction.X, G.Direction.Y, G.Direction.Z, *FString::Join(G.Buttons, TEXT(","))));
		// A push is towards the screen: Unreal's +X.
		if (G.Gesture == EPhoneWandGesture::Push && G.IsButtonHeld(TEXT("primary")) && G.Direction.X > 0.7)
		{
			S->bGotHeldPush = true;
		}
	});
	Wand->SetGestureSensitivity(PhoneWand::DefaultGestureThreshold, PhoneWand::DefaultGestureMinSpeed, PhoneWand::DefaultGestureTwistRate);
	AddInfo(FString::Printf(TEXT("Connecting to %s"), *Url));
	State->Start = FPlatformTime::Seconds();
	Wand->Connect(Url);
	ADD_LATENT_AUTOMATION_COMMAND(FPhoneWandGestureLiveWait(State, this));
	return true;
}

// ---------------------------------------------------------------------- managed relay

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandManagedRelayPathsTest, "PhoneWand.ManagedRelay.Paths", PhoneWandTests::Flags)

bool FPhoneWandManagedRelayPathsTest::RunTest(const FString& Parameters)
{
	int32 Port = 0;
	TestTrue(TEXT("127.0.0.1"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://127.0.0.1:8480/app"), Port));
	TestEqual(TEXT("127.0.0.1 port"), Port, 8480);
	TestTrue(TEXT("localhost"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://LocalHost:25480/app"), Port));
	TestEqual(TEXT("localhost port"), Port, 25480);
	TestTrue(TEXT("[::1]"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://[::1]:9000/app"), Port));
	TestEqual(TEXT("[::1] port"), Port, 9000);
	TestTrue(TEXT("no port"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://127.0.0.1/app"), Port));
	TestEqual(TEXT("no port means 8480"), Port, 8480);
	TestFalse(TEXT("LAN address"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://192.168.1.20:8480/app"), Port));
	TestFalse(TEXT("host name"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("wss://example.com/app"), Port));
	TestFalse(TEXT("127.0.0.1 as a subdomain"), UPhoneWandSubsystem::ParseLocalRelayUrl(TEXT("ws://127.0.0.1.example.com:8480/app"), Port));

	const FString Platform = UPhoneWandSubsystem::GetRelayPlatform();
#if PLATFORM_MAC
	TestEqual(TEXT("platform"), Platform, FString(TEXT("macos")));
#elif PLATFORM_WINDOWS
	TestEqual(TEXT("platform"), Platform, FString(TEXT("windows-x64")));
#endif
	const FString Exe = PLATFORM_WINDOWS ? TEXT("phone-wand-relay.exe") : TEXT("phone-wand-relay");

	// Default: the plugin's Resources/Relay/phone-wand-relay/<platform>/phone-wand-relay.
	const FString Default = UPhoneWandSubsystem::ResolveRelayExecutable(FString());
	TestTrue(TEXT("default is in the plugin's Resources/Relay"), Default.EndsWith(FString::Printf(TEXT("PhoneWand/Resources/Relay/phone-wand-relay/%s/%s"), *Platform, *Exe)));
	TestFalse(TEXT("default is absolute"), FPaths::IsRelative(Default));

	// A folder gets <platform>/<exe> added; a file is used as it is; relative is from the project.
	const FString Folder = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectIntermediateDir(), TEXT("PhoneWandRelayPathTest")));
	TestEqual(TEXT("folder"), UPhoneWandSubsystem::ResolveRelayExecutable(Folder), FPaths::Combine(Folder, Platform, Exe));
	const FString File = FPaths::Combine(Folder, TEXT("my-relay"));
	FFileHelper::SaveStringToFile(TEXT("not really"), *File);
	TestEqual(TEXT("file"), UPhoneWandSubsystem::ResolveRelayExecutable(File), File);
	TestEqual(TEXT("relative to the project"), UPhoneWandSubsystem::ResolveRelayExecutable(TEXT("Intermediate/PhoneWandRelayPathTest/my-relay")), File);
	IFileManager::Get().DeleteDirectory(*Folder, false, true);

	// Start Relay with a URL on another computer starts nothing and connects as usual.
	TStrongObjectPtr<UPhoneWandSubsystem> Wand = PhoneWandTests::MakeWand();
	Wand->SetStartRelay(true, Folder);
	Wand->Connect(TEXT("ws://192.0.2.1:1/app"));
	TestFalse(TEXT("nothing started for a remote relay"), Wand->IsRelayStartedByPlugin());
	Wand->Disconnect();
	return !HasAnyErrors();
}

DEFINE_LATENT_AUTOMATION_COMMAND_TWO_PARAMETER(FPhoneWandWaitForMissingRelay, TSharedPtr<TStrongObjectPtr<UPhoneWandSubsystem>>, Wand, double, Start);

bool FPhoneWandWaitForMissingRelay::Update()
{
	if (FPlatformTime::Seconds() - Start < 2.5)
	{
		return false;
	}
	(*Wand)->Disconnect();
	Wand->Reset();
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandManagedRelayMissingTest, "PhoneWand.ManagedRelay.Missing", PhoneWandTests::Flags)

bool FPhoneWandManagedRelayMissingTest::RunTest(const FString& Parameters)
{
#if PLATFORM_WINDOWS || PLATFORM_MAC || PLATFORM_LINUX
	// Nothing listens on this port and nothing is in the folder: the check fails, the relay is
	// not found, a warning says where it looked, and the client keeps trying to connect.
	const FString Folder = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectIntermediateDir(), TEXT("PhoneWandNoRelayHere")));
	AddExpectedMessagePlain(TEXT("there is no relay program at"), ELogVerbosity::Warning, EAutomationExpectedMessageFlags::Contains, 1);
	TSharedPtr<TStrongObjectPtr<UPhoneWandSubsystem>> Wand = MakeShared<TStrongObjectPtr<UPhoneWandSubsystem>>(PhoneWandTests::MakeWand());
	(*Wand)->SetStartRelay(true, Folder);
	(*Wand)->Connect(TEXT("ws://127.0.0.1:26499/app"));
	TestFalse(TEXT("nothing started"), (*Wand)->IsRelayStartedByPlugin());
	ADD_LATENT_AUTOMATION_COMMAND(FPhoneWandWaitForMissingRelay(Wand, FPlatformTime::Seconds()));
#endif
	return true;
}

namespace PhoneWandTests
{
	struct FProbe
	{
		bool bDone = false;
		bool bAnswered = false;
	};

	/** Ask http://127.0.0.1:<port>/status.json whether a relay is there, without blocking. */
	TSharedPtr<FProbe> ProbeRelay(int32 Port)
	{
		TSharedPtr<FProbe> Probe = MakeShared<FProbe>();
		TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
		Request->SetURL(FString::Printf(TEXT("http://127.0.0.1:%d/status.json"), Port));
		Request->SetVerb(TEXT("GET"));
		Request->SetTimeout(1.0f);
		Request->OnProcessRequestComplete().BindLambda([Probe](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnected)
		{
			Probe->bAnswered = bConnected && Response.IsValid() && Response->GetResponseCode() == 200
				&& Response->GetContentAsString().Contains(TEXT("\"relay\""));
			Probe->bDone = true;
		});
		if (!Request->ProcessRequest())
		{
			Probe->bDone = true;
		}
		return Probe;
	}

	struct FManagedRelayState
	{
		FString RelayDir;
		FString RelayArgs;
		FString Url;
		int32 AppPort = 0;
		int32 ExistingPort = 0; // for the second half: a relay the tester started, or 0 to start one here
		TStrongObjectPtr<UPhoneWandSubsystem> Wand;
		int32 Phase = 0;
		double PhaseStart = 0.0;
		uint32 RelayPid = 0;
		TSharedPtr<FProbe> Probe;
		double NextProbe = 0.0;
		FProcHandle External;

		int32 SecondPort() const { return ExistingPort != 0 ? ExistingPort : AppPort; }
		void NextPhase(int32 P) { Phase = P; PhaseStart = FPlatformTime::Seconds(); }
		double InPhase() const { return FPlatformTime::Seconds() - PhaseStart; }
	};
}

DEFINE_LATENT_AUTOMATION_COMMAND_TWO_PARAMETER(FPhoneWandManagedRelaySteps, TSharedPtr<PhoneWandTests::FManagedRelayState>, State, FAutomationTestBase*, Test);

bool FPhoneWandManagedRelaySteps::Update()
{
	PhoneWandTests::FManagedRelayState& S = *State;
	auto StopExternal = [&S]()
	{
		if (S.External.IsValid())
		{
			FPlatformProcess::TerminateProc(S.External, true);
			const double Deadline = FPlatformTime::Seconds() + 3.0;
			while (FPlatformProcess::IsProcRunning(S.External) && FPlatformTime::Seconds() < Deadline)
			{
				FPlatformProcess::Sleep(0.02f);
			}
			FPlatformProcess::CloseProc(S.External);
			S.External.Reset();
		}
	};

	switch (S.Phase)
	{
	case 0: // with no relay on the port: the subsystem starts one and connects
	{
		if (!S.Wand->IsConnected() && S.InPhase() < 20.0)
		{
			return false;
		}
		Test->AddInfo(FString::Printf(TEXT("Started case: connected=%d after %.1f s, started by plugin=%d, pid=%u"),
			S.Wand->IsConnected(), S.InPhase(), S.Wand->IsRelayStartedByPlugin(), S.Wand->GetRelayProcessId()));
		Test->TestTrue(TEXT("started: connected"), S.Wand->IsConnected());
		Test->TestTrue(TEXT("started: the plugin started the relay"), S.Wand->IsRelayStartedByPlugin());
		S.RelayPid = S.Wand->GetRelayProcessId();
		Test->TestTrue(TEXT("started: relay process is running"), FPlatformProcess::IsApplicationRunning(S.RelayPid));

		const double Before = FPlatformTime::Seconds();
		S.Wand->Deinitialize();
		const double StopTook = FPlatformTime::Seconds() - Before;
		Test->AddInfo(FString::Printf(TEXT("Deinitialize took %.2f s"), StopTook));
		Test->TestTrue(TEXT("stopped: within the lifeline wait"), StopTook < 3.5);
		Test->TestFalse(TEXT("stopped: no longer started by plugin"), S.Wand->IsRelayStartedByPlugin());
		Test->TestFalse(TEXT("stopped: relay process is gone"), FPlatformProcess::IsApplicationRunning(S.RelayPid));
		S.Wand.Reset();
		S.Probe = PhoneWandTests::ProbeRelay(S.AppPort);
		S.NextPhase(1);
		return false;
	}
	case 1: // status.json no longer answers
	{
		if (!S.Probe->bDone && S.InPhase() < 5.0)
		{
			return false;
		}
		Test->TestTrue(TEXT("stopped: probe finished"), S.Probe->bDone);
		Test->TestFalse(TEXT("stopped: status.json no longer answers"), S.Probe->bAnswered);

		if (S.ExistingPort == 0)
		{
			// Start a relay ourselves, as a developer would, without a lifeline.
			const FString Exe = UPhoneWandSubsystem::ResolveRelayExecutable(S.RelayDir);
			const FString Params = FString::Printf(TEXT("--no-open --app-port %d %s"), S.AppPort, *S.RelayArgs);
			S.External = FPlatformProcess::CreateProc(*Exe, *Params, true, true, true, nullptr, 0, nullptr, nullptr, nullptr);
			Test->TestTrue(TEXT("existing: started a relay by hand"), S.External.IsValid());
		}
		S.Probe.Reset();
		S.NextPhase(2);
		return false;
	}
	case 2: // wait for the hand-started relay to answer
	{
		if (S.Probe.IsValid() && S.Probe->bDone && S.Probe->bAnswered)
		{
			S.Wand = PhoneWandTests::MakeWand();
			S.Wand->SetStartRelay(true, S.RelayDir, S.RelayArgs);
			S.Wand->Connect(FString::Printf(TEXT("ws://127.0.0.1:%d/app"), S.SecondPort()));
			S.NextPhase(3);
			return false;
		}
		if (S.InPhase() > 20.0)
		{
			Test->AddError(TEXT("existing: the relay started by hand never answered"));
			StopExternal();
			return true;
		}
		if ((!S.Probe.IsValid() || S.Probe->bDone) && FPlatformTime::Seconds() >= S.NextProbe)
		{
			S.Probe = PhoneWandTests::ProbeRelay(S.SecondPort());
			S.NextProbe = FPlatformTime::Seconds() + 0.25;
		}
		return false;
	}
	case 3: // with a relay already running: connect to it, start nothing
	{
		if (!S.Wand->IsConnected() && S.InPhase() < 15.0)
		{
			return false;
		}
		Test->AddInfo(FString::Printf(TEXT("Existing case: connected=%d after %.1f s, started by plugin=%d"),
			S.Wand->IsConnected(), S.InPhase(), S.Wand->IsRelayStartedByPlugin()));
		Test->TestTrue(TEXT("existing: connected"), S.Wand->IsConnected());
		Test->TestFalse(TEXT("existing: the plugin started nothing"), S.Wand->IsRelayStartedByPlugin());
		Test->TestEqual(TEXT("existing: no relay process of its own"), S.Wand->GetRelayProcessId(), 0u);
		S.Wand->Deinitialize();
		S.Wand.Reset();
		S.Probe = PhoneWandTests::ProbeRelay(S.SecondPort());
		S.NextPhase(4);
		return false;
	}
	case 4: // and the existing relay is still there afterwards
	{
		if (!S.Probe->bDone && S.InPhase() < 5.0)
		{
			return false;
		}
		Test->TestTrue(TEXT("existing: still answers after the client shut down"), S.Probe->bAnswered);
		if (S.External.IsValid())
		{
			Test->TestTrue(TEXT("existing: hand-started process still running"), FPlatformProcess::IsProcRunning(S.External));
		}
		StopExternal();
		return true;
	}
	default:
		StopExternal();
		return true;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FPhoneWandManagedRelayLiveTest, "PhoneWand.ManagedRelay.Live", PhoneWandTests::Flags)

bool FPhoneWandManagedRelayLiveTest::RunTest(const FString& Parameters)
{
	FString Dir = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_RELAY_DIR"));
	if (Dir.IsEmpty())
	{
		FParse::Value(FCommandLine::Get(), TEXT("PhoneWandRelayDir="), Dir);
	}
	if (Dir.IsEmpty())
	{
		AddInfo(TEXT("Skipped: set PHONEWAND_RELAY_DIR to a phone-wand-relay folder (holding macos, windows-x64, ...) to run."));
		return true;
	}
	const FString Exe = UPhoneWandSubsystem::ResolveRelayExecutable(Dir);
	if (!FPaths::FileExists(Exe))
	{
		AddError(FString::Printf(TEXT("No relay binary at %s"), *Exe));
		return false;
	}

	// Ports away from the defaults (8480, 8443) so a developer's relay is left alone.
	// PHONEWAND_RELAY_TEST_PORTS=<app>,<phone> overrides them.
	int32 AppPort = 26480;
	int32 PhonePort = 26443;
	const FString Ports = FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_RELAY_TEST_PORTS"));
	FString A, B;
	if (Ports.Split(TEXT(","), &A, &B))
	{
		AppPort = FCString::Atoi(*A);
		PhonePort = FCString::Atoi(*B);
	}

	TSharedPtr<PhoneWandTests::FManagedRelayState> State = MakeShared<PhoneWandTests::FManagedRelayState>();
	State->RelayDir = Dir;
	State->AppPort = AppPort;
	State->Url = FString::Printf(TEXT("ws://127.0.0.1:%d/app"), AppPort);
	const FString DataDir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectSavedDir(), TEXT("PhoneWandRelayTest")));
	State->RelayArgs = FString::Printf(TEXT("--port %d --no-landing --data-dir \"%s\""), PhonePort, *DataDir);
	// PHONEWAND_RELAY_EXISTING_PORT=<app port>: for the second half, use a relay the tester has
	// already started on that port, instead of one this test starts by hand.
	State->ExistingPort = FCString::Atoi(*FPlatformMisc::GetEnvironmentVariable(TEXT("PHONEWAND_RELAY_EXISTING_PORT")));

	State->Wand = PhoneWandTests::MakeWand();
	State->Wand->SetStartRelay(true, Dir, State->RelayArgs);
	AddInfo(FString::Printf(TEXT("Relay %s; connecting to %s with Start Relay on"), *Exe, *State->Url));
	State->NextPhase(0);
	State->Wand->Connect(State->Url);
	ADD_LATENT_AUTOMATION_COMMAND(FPhoneWandManagedRelaySteps(State, this));
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
