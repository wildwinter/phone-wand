# Phone Wand for Unity

Phone Wand turns phones into pointers for a shared screen. Players open a web page on their phone,
and this package gives your Unity project each player's orientation, pointing direction, screen
position and button presses, from a Phone Wand relay running on the same computer.

```csharp
using StoryTools.PhoneWand;
using UnityEngine;

public class Pointers : MonoBehaviour
{
    void Start()
    {
        var wand = gameObject.AddComponent<PhoneWandClient>();
        wand.Button += (e, player) =>
        {
            if (e.Button == PhoneButton.Primary && e.Down)
                Debug.Log(player.Name + " clicked at " + PhoneWandClient.ScreenPosition(player.Pose));
        };
    }
}
```

- Install: Package Manager, "Add package from git URL", then
  `https://github.com/wildwinter/phone-wand.git?path=clients/unity/PhoneWand`
- Documentation: [docs/clients/unity.md](https://github.com/wildwinter/phone-wand/blob/main/docs/clients/unity.md)
- Protocol: [docs/protocol.md](https://github.com/wildwinter/phone-wand/blob/main/docs/protocol.md)
- Sample: Cursors (import it from the Package Manager's Samples tab).

MIT licence. By Ian Thomas (storytools.se).
