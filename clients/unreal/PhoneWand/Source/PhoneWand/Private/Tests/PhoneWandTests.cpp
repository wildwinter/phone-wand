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
//   PhoneWand.Live.Relay                  connects to a running relay; only does anything when
//                                         PHONEWAND_LIVE_URL (or -PhoneWandLiveUrl=) is set
//
// The conformance folder is found relative to the plugin (<repo>/clients/unreal/PhoneWand ->
// <repo>/conformance). Override it with the PHONEWAND_CONFORMANCE_DIR environment variable or the
// -PhoneWandConformance=<dir> command-line switch.

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "HAL/PlatformMisc.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/AutomationTest.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "PhoneWandLibrary.h"
#include "PhoneWandSubsystem.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "UObject/Package.h"
#include "UObject/StrongObjectPtr.h"
#include "Engine/GameInstance.h"

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
				Dir = FPaths::Combine(Plugin->GetBaseDir(), TEXT(".."), TEXT(".."), TEXT(".."), TEXT("conformance"));
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
	void CompareJson(FAutomationTestBase& Test, const FString& Path, const TSharedPtr<FJsonValue>& Expected, const TSharedPtr<FJsonValue>& Actual)
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
				CompareJson(Test, FString::Printf(TEXT("%s[%d]"), *Path, i), E[i], A[i]);
			}
			break;
		}
		case EJson::Object:
		{
			const TSharedPtr<FJsonObject> E = Expected->AsObject();
			const TSharedPtr<FJsonObject> A = Actual->AsObject();
			for (const TPair<FString, TSharedPtr<FJsonValue>>& Pair : E->Values)
			{
				CompareJson(Test, Path + TEXT(".") + Pair.Key, Pair.Value, A->TryGetField(Pair.Key));
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

#endif // WITH_DEV_AUTOMATION_TESTS
