// Rig-frame value types. The rig frame's axes are [right, up, forward], which match Unity's
// x, y and z exactly, so converting to Unity is a straight copy (see PhoneWandExtensions in the
// Unity assembly). These types exist so the core has no UnityEngine dependency.

using System;
using System.Globalization;

namespace StoryTools.PhoneWand
{
    /// <summary>A vector in the rig frame: right, up, forward. Unity: new Vector3(Right, Up, Forward).</summary>
    [Serializable]
    public struct RigVector3 : IEquatable<RigVector3>
    {
        public double Right;
        public double Up;
        public double Forward;

        public RigVector3(double right, double up, double forward)
        {
            Right = right;
            Up = up;
            Forward = forward;
        }

        public static readonly RigVector3 Zero = new RigVector3(0, 0, 0);
        /// <summary>The rig's up axis, [0, 1, 0].</summary>
        public static readonly RigVector3 UpAxis = new RigVector3(0, 1, 0);
        /// <summary>The rig's forward axis, [0, 0, 1].</summary>
        public static readonly RigVector3 ForwardAxis = new RigVector3(0, 0, 1);
        /// <summary>The rig's right axis, [1, 0, 0].</summary>
        public static readonly RigVector3 RightAxis = new RigVector3(1, 0, 0);

        public double Length => Math.Sqrt(Right * Right + Up * Up + Forward * Forward);

        /// <summary>The pointing direction for a yaw and pitch in degrees, as the protocol defines it.</summary>
        public static RigVector3 FromYawPitch(double yawDegrees, double pitchDegrees)
        {
            double yaw = yawDegrees * Math.PI / 180.0;
            double pitch = pitchDegrees * Math.PI / 180.0;
            return new RigVector3(Math.Sin(yaw) * Math.Cos(pitch), Math.Sin(pitch), Math.Cos(yaw) * Math.Cos(pitch));
        }

        public bool Equals(RigVector3 other) => Right == other.Right && Up == other.Up && Forward == other.Forward;
        public override bool Equals(object obj) => obj is RigVector3 other && Equals(other);
        public override int GetHashCode() => Right.GetHashCode() ^ (Up.GetHashCode() << 2) ^ (Forward.GetHashCode() >> 2);

        public override string ToString()
        {
            return string.Format(CultureInfo.InvariantCulture, "[{0}, {1}, {2}]", Right, Up, Forward);
        }
    }

    /// <summary>
    /// A rotation in the rig frame, [x, y, z, w]. It rotates the phone body into the rig frame.
    /// Unity: new Quaternion(X, Y, Z, W).
    /// </summary>
    [Serializable]
    public struct RigQuaternion : IEquatable<RigQuaternion>
    {
        public double X;
        public double Y;
        public double Z;
        public double W;

        public RigQuaternion(double x, double y, double z, double w)
        {
            X = x;
            Y = y;
            Z = z;
            W = w;
        }

        public static readonly RigQuaternion Identity = new RigQuaternion(0, 0, 0, 1);

        /// <summary>Rotate a vector by this quaternion.</summary>
        public RigVector3 Rotate(RigVector3 v)
        {
            // v' = v + w t + q x t, where t = 2 (q x v)
            double tx = 2 * (Y * v.Forward - Z * v.Up);
            double ty = 2 * (Z * v.Right - X * v.Forward);
            double tz = 2 * (X * v.Up - Y * v.Right);
            return new RigVector3(
                v.Right + W * tx + (Y * tz - Z * ty),
                v.Up + W * ty + (Z * tx - X * tz),
                v.Forward + W * tz + (X * ty - Y * tx));
        }

        /// <summary>The phone's pointing direction (body forward rotated into the rig frame).</summary>
        public RigVector3 Forward => Rotate(RigVector3.ForwardAxis);

        /// <summary>The direction out of the phone's screen, in the rig frame.</summary>
        public RigVector3 Up => Rotate(RigVector3.UpAxis);

        public bool Equals(RigQuaternion other) => X == other.X && Y == other.Y && Z == other.Z && W == other.W;
        public override bool Equals(object obj) => obj is RigQuaternion other && Equals(other);
        public override int GetHashCode() => X.GetHashCode() ^ (Y.GetHashCode() << 2) ^ (Z.GetHashCode() >> 2) ^ (W.GetHashCode() >> 1);

        public override string ToString()
        {
            return string.Format(CultureInfo.InvariantCulture, "[{0}, {1}, {2}, {3}]", X, Y, Z, W);
        }
    }

    /// <summary>
    /// A normalised screen position: [0, 0] is the top-left corner and [1, 1] the bottom-right.
    /// Values outside 0..1 mean the player is pointing off the screen.
    /// </summary>
    [Serializable]
    public struct ScreenPoint : IEquatable<ScreenPoint>
    {
        public double X;
        public double Y;

        public ScreenPoint(double x, double y)
        {
            X = x;
            Y = y;
        }

        /// <summary>True when the point is on the screen (both coordinates within 0..1).</summary>
        public bool IsOnScreen => X >= 0 && X <= 1 && Y >= 0 && Y <= 1;

        public bool Equals(ScreenPoint other) => X == other.X && Y == other.Y;
        public override bool Equals(object obj) => obj is ScreenPoint other && Equals(other);
        public override int GetHashCode() => X.GetHashCode() ^ (Y.GetHashCode() << 2);

        public override string ToString()
        {
            return string.Format(CultureInfo.InvariantCulture, "[{0}, {1}]", X, Y);
        }
    }
}
