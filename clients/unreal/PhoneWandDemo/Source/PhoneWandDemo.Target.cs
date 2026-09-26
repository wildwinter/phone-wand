// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

using UnrealBuildTool;

public class PhoneWandDemoTarget : TargetRules
{
	public PhoneWandDemoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("PhoneWandDemo");
	}
}
