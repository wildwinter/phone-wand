class_name PhoneWandFrames
extends RefCounted
## Conversions from the Phone Wand rig frame to Godot's frame.
##
## The relay sends vectors as [right, up, forward] and quaternions as [x, y, z, w] in the rig
## frame. Godot is right-handed with x right, y up and -z forward, so:
##
##   direction [r, u, f]     -> Vector3(r, u, -f)
##   quaternion [x, y, z, w] -> Quaternion(-x, -y, z, w)
##
## Rotating Godot's forward (Vector3.FORWARD, which is -z) by the converted quaternion gives the
## converted direction, and rotating Vector3.UP gives the phone's screen normal.


## Converts a rig-frame vector [right, up, forward] to a Godot Vector3.
## Returns Vector3.ZERO if the array is missing or too short.
static func dir_to_godot(rig: Variant) -> Vector3:
	if not (rig is Array) or rig.size() < 3:
		return Vector3.ZERO
	return Vector3(float(rig[0]), float(rig[1]), -float(rig[2]))


## Converts a rig-frame quaternion [x, y, z, w] to a Godot Quaternion, normalised.
## Returns the identity if the array is missing, too short, or zero length.
static func quat_to_godot(rig: Variant) -> Quaternion:
	if not (rig is Array) or rig.size() < 4:
		return Quaternion.IDENTITY
	var q := Quaternion(-float(rig[0]), -float(rig[1]), float(rig[2]), float(rig[3]))
	var length := q.length()
	if length < 0.000001:
		return Quaternion.IDENTITY
	return q / length


## Converts a Godot direction back to a rig-frame array [right, up, forward].
static func dir_to_rig(v: Vector3) -> Array:
	return [v.x, v.y, -v.z]


## Converts a Godot quaternion back to a rig-frame array [x, y, z, w].
static func quat_to_rig(q: Quaternion) -> Array:
	return [-q.x, -q.y, q.z, q.w]


## The unit ray direction for yaw and pitch in degrees, in Godot's frame.
## Matches the protocol's [sin(yaw) cos(pitch), sin(pitch), cos(yaw) cos(pitch)].
static func yaw_pitch_to_godot(yaw_degrees: float, pitch_degrees: float) -> Vector3:
	var yaw := deg_to_rad(yaw_degrees)
	var pitch := deg_to_rad(pitch_degrees)
	return Vector3(sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))


## Converts a normalised screen position ([0, 0] top-left, [1, 1] bottom-right) to pixels.
static func screen_to_pixels(screen: Vector2, size: Vector2) -> Vector2:
	return screen * size
