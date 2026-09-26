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
			"Json", // PhoneWandTypes.h: layouts to and from the protocol's JSON
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"WebSockets",
			"HTTP",
			"Projects",
		});

		StageRelay(Target);
	}

	/**
	 * Stage the relay (docs/shipping.md) with packaged games when it is in the plugin, at
	 * Resources/Relay/phone-wand-relay/<platform>/phone-wand-relay. Only the build for the target
	 * platform is staged, and only if it is there, so builds without the binaries still work.
	 */
	private void StageRelay(ReadOnlyTargetRules Target)
	{
		string Folder = null;
		string Exe = "phone-wand-relay";
		if (Target.Platform == UnrealTargetPlatform.Mac) Folder = "macos";
		else if (Target.Platform == UnrealTargetPlatform.Win64) { Folder = "windows-x64"; Exe = "phone-wand-relay.exe"; }
		else if (Target.Platform == UnrealTargetPlatform.Linux) Folder = "linux-x64";
		else if (Target.Platform == UnrealTargetPlatform.LinuxArm64) Folder = "linux-arm64";
		if (Folder == null)
		{
			return;
		}
		string Relative = System.IO.Path.Combine("Resources", "Relay", "phone-wand-relay", Folder, Exe);
		if (System.IO.File.Exists(System.IO.Path.Combine(PluginDirectory, Relative)))
		{
			RuntimeDependencies.Add("$(PluginDir)/Resources/Relay/phone-wand-relay/" + Folder + "/" + Exe, StagedFileType.NonUFS);
		}
	}
}
