// Conversions from Phone Wand's rig-frame types to Unity types.
//
// The rig frame is [right, up, forward], which is Unity's x, y, z, so vectors and quaternions copy
// straight across: new Vector3(right, up, forward) and new Quaternion(x, y, z, w). Rotating
// Vector3.forward by the quaternion gives the pointing direction; Vector3.up gives the direction
// out of the phone's screen.

using UnityEngine;

namespace StoryTools.PhoneWand
{
    public static class PhoneWandExtensions
    {
        /// <summary>A rig vector as a Unity Vector3 (x right, y up, z forward).</summary>
        public static Vector3 ToVector3(this RigVector3 v)
        {
            return new Vector3((float)v.Right, (float)v.Up, (float)v.Forward);
        }

        /// <summary>A rig quaternion as a Unity Quaternion.</summary>
        public static Quaternion ToQuaternion(this RigQuaternion q)
        {
            return new Quaternion((float)q.X, (float)q.Y, (float)q.Z, (float)q.W);
        }

        /// <summary>A normalised screen point as a Vector2 (still 0..1, origin top-left).</summary>
        public static Vector2 ToVector2(this ScreenPoint p)
        {
            return new Vector2((float)p.X, (float)p.Y);
        }

        /// <summary>
        /// A normalised screen point in Unity screen pixels (origin bottom-left). With a camera, within
        /// that camera's pixel rect; otherwise the whole screen.
        /// </summary>
        public static Vector2 ToScreenPixels(this ScreenPoint p, Camera camera = null)
        {
            Rect rect = camera != null ? camera.pixelRect : new Rect(0, 0, Screen.width, Screen.height);
            return new Vector2(rect.x + (float)p.X * rect.width, rect.y + (1f - (float)p.Y) * rect.height);
        }

        /// <summary>A normalised screen point in GUI pixels (origin top-left, for OnGUI).</summary>
        public static Vector2 ToGuiPixels(this ScreenPoint p)
        {
            return new Vector2((float)p.X * Screen.width, (float)p.Y * Screen.height);
        }

        /// <summary>The pose's pointing direction as a Unity vector.</summary>
        public static Vector3 DirectionVector(this PlayerPose pose) => pose.Direction.ToVector3();

        /// <summary>The pose's orientation as a Unity rotation.</summary>
        public static Quaternion RotationQuaternion(this PlayerPose pose) => pose.Rotation.ToQuaternion();

        /// <summary>
        /// The pose's acceleration in m/s^2 (gravity removed) as a Unity vector, or null when the
        /// phone sent none.
        /// </summary>
        public static Vector3? AccelVector(this PlayerPose pose) => pose.Accel.HasValue ? pose.Accel.Value.ToVector3() : (Vector3?)null;

        /// <summary>A gesture's direction of movement as a Unity unit vector (zero for shakes and twists).</summary>
        public static Vector3 DirectionVector(this GestureEvent gesture) => gesture.Dir.ToVector3();

        /// <summary>
        /// A world-space ray from origin along the player's pointing direction, turned by the
        /// frame's rotation (for example a camera's transform, so forward means into the scene).
        /// </summary>
        public static Ray ToRay(this PlayerPose pose, Vector3 origin, Quaternion frame)
        {
            return new Ray(origin, frame * pose.Direction.ToVector3());
        }

        /// <summary>Set a control's colour from a Unity Color and return the control, for chaining.</summary>
        public static Control WithColour(this Control control, Color colour)
        {
            return control.WithColour("#" + ColorUtility.ToHtmlStringRGB(colour).ToLowerInvariant());
        }

        /// <summary>The player's colour as a Unity Color (white if it cannot be read).</summary>
        public static Color UnityColour(this Player player)
        {
            Color c;
            return player != null && ColorUtility.TryParseHtmlString(player.Colour, out c) ? c : Color.white;
        }
    }
}
