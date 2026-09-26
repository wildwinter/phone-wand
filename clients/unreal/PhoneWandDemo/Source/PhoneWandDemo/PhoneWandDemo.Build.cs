// Phone Wand demo. MIT licence, Ian Thomas (storytools.se).

using UnrealBuildTool;

public class PhoneWandDemo : ModuleRules
{
	public PhoneWandDemo(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"PhoneWand",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"HTTP",
			"InputCore",
		});
	}
}
