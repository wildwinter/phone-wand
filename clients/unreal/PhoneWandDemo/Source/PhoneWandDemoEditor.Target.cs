// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

using UnrealBuildTool;

public class PhoneWandDemoEditorTarget : TargetRules
{
	public PhoneWandDemoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PhoneWandDemo");
	}
}
