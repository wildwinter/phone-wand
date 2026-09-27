// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).
//
// Layouts and control values to and from the protocol's JSON (docs/protocol.md, "Layouts").

#include "PhoneWandTypes.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "PhoneWandLibrary.h"

namespace
{
	bool ParseControlType(const FString& Name, EPhoneWandControlType& Out)
	{
		if (Name == TEXT("button")) { Out = EPhoneWandControlType::Button; return true; }
		if (Name == TEXT("toggle")) { Out = EPhoneWandControlType::Toggle; return true; }
		if (Name == TEXT("slider")) { Out = EPhoneWandControlType::Slider; return true; }
		if (Name == TEXT("choice")) { Out = EPhoneWandControlType::Choice; return true; }
		if (Name == TEXT("label")) { Out = EPhoneWandControlType::Label; return true; }
		if (Name == TEXT("dpad")) { Out = EPhoneWandControlType::Dpad; return true; }
		if (Name == TEXT("crawl")) { Out = EPhoneWandControlType::Crawl; return true; }
		return false;
	}
}

FString FPhoneWandControlValue::ToString() const
{
	switch (Type)
	{
	case EPhoneWandValueType::Bool: return bValue ? TEXT("true") : TEXT("false");
	case EPhoneWandValueType::Number: return FString::SanitizeFloat(Number, 0);
	case EPhoneWandValueType::Text: return Text;
	default: return FString();
	}
}

namespace PhoneWand
{
	FString ToString(EPhoneWandTemplate Template)
	{
		switch (Template)
		{
		case EPhoneWandTemplate::Primary: return TEXT("primary");
		case EPhoneWandTemplate::Pair: return TEXT("pair");
		case EPhoneWandTemplate::PrimaryRow: return TEXT("primary-row");
		case EPhoneWandTemplate::Grid: return TEXT("grid");
		case EPhoneWandTemplate::Rows: return TEXT("rows");
		case EPhoneWandTemplate::Columns: return TEXT("columns");
		default: return TEXT("primary-secondary");
		}
	}

	FString ToString(EPhoneWandControlType Type)
	{
		switch (Type)
		{
		case EPhoneWandControlType::Toggle: return TEXT("toggle");
		case EPhoneWandControlType::Slider: return TEXT("slider");
		case EPhoneWandControlType::Choice: return TEXT("choice");
		case EPhoneWandControlType::Label: return TEXT("label");
		case EPhoneWandControlType::Dpad: return TEXT("dpad");
		case EPhoneWandControlType::Crawl: return TEXT("crawl");
		default: return TEXT("button");
		}
	}

	FString ToString(EPhoneWandDpadDirection Direction)
	{
		switch (Direction)
		{
		case EPhoneWandDpadDirection::Down: return TEXT("down");
		case EPhoneWandDpadDirection::Left: return TEXT("left");
		case EPhoneWandDpadDirection::Right: return TEXT("right");
		default: return TEXT("up");
		}
	}

	FString ToString(EPhoneWandCrawlDirection Direction)
	{
		switch (Direction)
		{
		case EPhoneWandCrawlDirection::Back: return TEXT("back");
		case EPhoneWandCrawlDirection::StepLeft: return TEXT("step-left");
		case EPhoneWandCrawlDirection::StepRight: return TEXT("step-right");
		case EPhoneWandCrawlDirection::TurnLeft: return TEXT("turn-left");
		case EPhoneWandCrawlDirection::TurnRight: return TEXT("turn-right");
		default: return TEXT("forward");
		}
	}

	bool ParseTemplate(const FString& Name, EPhoneWandTemplate& Out)
	{
		if (Name == TEXT("primary")) { Out = EPhoneWandTemplate::Primary; return true; }
		if (Name == TEXT("primary-secondary")) { Out = EPhoneWandTemplate::PrimarySecondary; return true; }
		if (Name == TEXT("pair")) { Out = EPhoneWandTemplate::Pair; return true; }
		if (Name == TEXT("primary-row")) { Out = EPhoneWandTemplate::PrimaryRow; return true; }
		if (Name == TEXT("grid")) { Out = EPhoneWandTemplate::Grid; return true; }
		if (Name == TEXT("rows")) { Out = EPhoneWandTemplate::Rows; return true; }
		if (Name == TEXT("columns")) { Out = EPhoneWandTemplate::Columns; return true; }
		return false;
	}

	FPhoneWandLayout DefaultLayout()
	{
		FPhoneWandLayout Layout;
		Layout.Template = EPhoneWandTemplate::PrimarySecondary;
		FPhoneWandControl Primary;
		Primary.Id = PrimaryButton;
		Primary.Label = TEXT("Primary");
		FPhoneWandControl Secondary;
		Secondary.Id = SecondaryButton;
		Secondary.Label = TEXT("Secondary");
		Layout.Controls = { Primary, Secondary };
		return Layout;
	}

	TSharedRef<FJsonObject> ControlToJson(const FPhoneWandControl& C)
	{
		TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("id"), C.Id);
		O->SetStringField(TEXT("type"), ToString(C.Type));
		if (!C.Label.IsEmpty())
		{
			O->SetStringField(TEXT("label"), C.Label);
		}
		if (C.bHasColour)
		{
			O->SetStringField(TEXT("colour"), UPhoneWandLibrary::ColourToHex(C.Colour));
		}
		switch (C.Type)
		{
		case EPhoneWandControlType::Toggle:
			O->SetBoolField(TEXT("value"), C.bValue);
			break;
		case EPhoneWandControlType::Slider:
			O->SetNumberField(TEXT("value"), FMath::Clamp(C.Value, 0.0, 1.0));
			O->SetStringField(TEXT("orientation"), C.bVertical ? TEXT("vertical") : TEXT("horizontal"));
			if (C.bSpring)
			{
				O->SetNumberField(TEXT("spring"), FMath::Clamp(C.Spring, 0.0, 1.0));
			}
			else
			{
				O->SetField(TEXT("spring"), MakeShared<FJsonValueNull>());
			}
			break;
		case EPhoneWandControlType::Choice:
		{
			TArray<TSharedPtr<FJsonValue>> Options;
			for (const FString& Option : C.Options)
			{
				Options.Add(MakeShared<FJsonValueString>(Option));
			}
			O->SetArrayField(TEXT("options"), Options);
			O->SetNumberField(TEXT("value"), C.Index);
			break;
		}
		case EPhoneWandControlType::Label:
			O->SetStringField(TEXT("text"), C.Text);
			break;
		default:
			break;
		}
		return O;
	}

	TSharedRef<FJsonObject> LayoutToJson(const FPhoneWandLayout& Layout)
	{
		TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetStringField(TEXT("template"), ToString(Layout.Template));
		TArray<TSharedPtr<FJsonValue>> Controls;
		for (const FPhoneWandControl& C : Layout.Controls)
		{
			Controls.Add(MakeShared<FJsonValueObject>(ControlToJson(C)));
		}
		O->SetArrayField(TEXT("controls"), Controls);
		const bool bRows = Layout.Template == EPhoneWandTemplate::Rows;
		if (bRows || Layout.Template == EPhoneWandTemplate::Columns)
		{
			TArray<TSharedPtr<FJsonValue>> Counts;
			for (const int32 N : Layout.Counts)
			{
				Counts.Add(MakeShared<FJsonValueNumber>(N));
			}
			O->SetArrayField(bRows ? TEXT("rows") : TEXT("columns"), Counts);
			if (Layout.Sizes.Num() > 0)
			{
				TArray<TSharedPtr<FJsonValue>> Sizes;
				for (const double Size : Layout.Sizes)
				{
					Sizes.Add(MakeShared<FJsonValueNumber>(Size));
				}
				O->SetArrayField(bRows ? TEXT("heights") : TEXT("widths"), Sizes);
			}
		}
		return O;
	}

	FPhoneWandLayout LayoutFromJson(const FJsonObject& Json)
	{
		FPhoneWandLayout Layout;
		FString Name;
		if (Json.TryGetStringField(TEXT("template"), Name))
		{
			ParseTemplate(Name, Layout.Template);
		}
		const bool bRows = Layout.Template == EPhoneWandTemplate::Rows;
		if (bRows || Layout.Template == EPhoneWandTemplate::Columns)
		{
			const TArray<TSharedPtr<FJsonValue>>* Counts = nullptr;
			if (Json.TryGetArrayField(bRows ? TEXT("rows") : TEXT("columns"), Counts) && Counts != nullptr)
			{
				for (const TSharedPtr<FJsonValue>& N : *Counts)
				{
					int32 Count = 0;
					if (N.IsValid() && N->TryGetNumber(Count))
					{
						Layout.Counts.Add(Count);
					}
				}
			}
			const TArray<TSharedPtr<FJsonValue>>* Sizes = nullptr;
			if (Json.TryGetArrayField(bRows ? TEXT("heights") : TEXT("widths"), Sizes) && Sizes != nullptr)
			{
				for (const TSharedPtr<FJsonValue>& N : *Sizes)
				{
					double Size = 0.0;
					if (N.IsValid() && N->TryGetNumber(Size))
					{
						Layout.Sizes.Add(Size);
					}
				}
			}
		}
		const TArray<TSharedPtr<FJsonValue>>* List = nullptr;
		if (!Json.TryGetArrayField(TEXT("controls"), List) || List == nullptr)
		{
			return Layout;
		}
		for (const TSharedPtr<FJsonValue>& V : *List)
		{
			const TSharedPtr<FJsonObject>* Obj = nullptr;
			if (!V.IsValid() || !V->TryGetObject(Obj) || Obj == nullptr || !Obj->IsValid())
			{
				continue;
			}
			const FJsonObject& J = **Obj;
			FPhoneWandControl C;
			FString TypeName;
			if (!J.TryGetStringField(TEXT("type"), TypeName) || !ParseControlType(TypeName, C.Type))
			{
				continue; // a control type from a newer relay
			}
			J.TryGetStringField(TEXT("id"), C.Id);
			J.TryGetStringField(TEXT("label"), C.Label);
			FString Colour;
			if (J.TryGetStringField(TEXT("colour"), Colour) && !Colour.IsEmpty())
			{
				C.bHasColour = true;
				C.Colour = UPhoneWandLibrary::ColourFromHex(Colour);
			}
			switch (C.Type)
			{
			case EPhoneWandControlType::Toggle:
				J.TryGetBoolField(TEXT("value"), C.bValue);
				break;
			case EPhoneWandControlType::Slider:
			{
				J.TryGetNumberField(TEXT("value"), C.Value);
				FString Orientation;
				C.bVertical = J.TryGetStringField(TEXT("orientation"), Orientation) && Orientation == TEXT("vertical");
				double Spring = 0.0;
				C.bSpring = J.TryGetNumberField(TEXT("spring"), Spring);
				C.Spring = C.bSpring ? Spring : 0.0;
				break;
			}
			case EPhoneWandControlType::Choice:
			{
				const TArray<TSharedPtr<FJsonValue>>* Options = nullptr;
				if (J.TryGetArrayField(TEXT("options"), Options) && Options != nullptr)
				{
					for (const TSharedPtr<FJsonValue>& Option : *Options)
					{
						FString S;
						if (Option.IsValid() && Option->TryGetString(S))
						{
							C.Options.Add(S);
						}
					}
				}
				J.TryGetNumberField(TEXT("value"), C.Index);
				break;
			}
			case EPhoneWandControlType::Label:
				J.TryGetStringField(TEXT("text"), C.Text);
				break;
			default:
				break;
			}
			Layout.Controls.Add(MoveTemp(C));
		}
		return Layout;
	}

	TSharedRef<FJsonValue> ControlValueToJson(const FPhoneWandControlValue& Value)
	{
		switch (Value.Type)
		{
		case EPhoneWandValueType::Bool: return MakeShared<FJsonValueBoolean>(Value.bValue);
		case EPhoneWandValueType::Number: return MakeShared<FJsonValueNumber>(Value.Number);
		case EPhoneWandValueType::Text: return MakeShared<FJsonValueString>(Value.Text);
		default: return MakeShared<FJsonValueNull>();
		}
	}

	FPhoneWandControlValue ControlValueFromJson(const TSharedPtr<FJsonValue>& Json)
	{
		if (!Json.IsValid())
		{
			return FPhoneWandControlValue();
		}
		switch (Json->Type)
		{
		case EJson::Boolean: return FPhoneWandControlValue::MakeBool(Json->AsBool());
		case EJson::Number: return FPhoneWandControlValue::MakeNumber(Json->AsNumber());
		case EJson::String: return FPhoneWandControlValue::MakeText(Json->AsString());
		default: return FPhoneWandControlValue();
		}
	}
}
