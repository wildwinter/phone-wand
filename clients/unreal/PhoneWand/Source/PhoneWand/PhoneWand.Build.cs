// Phone Wand for Unreal Engine. MIT licence, Ian Thomas (storytools.se).

using UnrealBuildTool;

public class PhoneWand : ModuleRules
{
	public PhoneWand(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"DeveloperSettings",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"WebSockets",
			"Json",
			"Projects",
		});
	}
}
