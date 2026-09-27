class_name PhoneWandLayout
extends RefCounted
## Builds phone layouts: Dictionaries in the protocol's JSON shape, for PhoneWandClient.set_layout.
##
##   PhoneWand.set_layout(PhoneWandLayout.layout("primary-row", [
##       PhoneWandLayout.button("shoot", "Shoot"),
##       PhoneWandLayout.button("reload", "Reload"),
##       PhoneWandLayout.toggle("zoom", "Zoom"),
##       PhoneWandLayout.label("ammo", "Ammo", "12"),
##   ]))
##
## Templates: "primary" (1 control), "primary-secondary" (2), "pair" (2), "primary-row" (1 to 4)
## and "grid" (1 to 6). In the primary templates the first control must be a button, dpad or crawl.
## colour is a Color or "#rrggbb", or null for the player's colour. See docs/layouts.md.
##
## A dpad or crawl control is a set of buttons named "<id>.<direction>", such as "move.up" or
## "walk.turn-left" (see button_for). Their presses arrive as PhoneWandClient.button like any other.

const TEMPLATES := ["primary", "primary-secondary", "pair", "primary-row", "grid"]

const UP := "up"
const DOWN := "down"
const LEFT := "left"
const RIGHT := "right"
const FORWARD := "forward"
const BACK := "back"
const STEP_LEFT := "step-left"
const STEP_RIGHT := "step-right"
const TURN_LEFT := "turn-left"
const TURN_RIGHT := "turn-right"

## A dpad's directions.
const DPAD_DIRECTIONS := [UP, DOWN, LEFT, RIGHT]
## A crawl control's directions.
const CRAWL_DIRECTIONS := [FORWARD, BACK, STEP_LEFT, STEP_RIGHT, TURN_LEFT, TURN_RIGHT]


## A layout: a template and its controls, in order.
static func layout(template: String, controls: Array) -> Dictionary:
	return {"template": template, "controls": controls.duplicate()}


## What phones show until an app sends a layout: big Primary and smaller Secondary buttons.
static func default_layout() -> Dictionary:
	return layout("primary-secondary", [button("primary", "Primary"), button("secondary", "Secondary")])


## A button. Presses arrive as PhoneWandClient.button with this id.
static func button(id: String, label: String = "", colour: Variant = null) -> Dictionary:
	return _control(id, "button", label, colour)


## Four arrows. Each is a button named "<id>.<direction>" (up, down, left, right): see button_for.
static func dpad(id: String, label: String = "", colour: Variant = null) -> Dictionary:
	return _control(id, "dpad", label, colour)


## Dungeon-crawler keys: forward, back, step left and right, turn left and right. Each is a button
## named "<id>.<direction>": see button_for.
static func crawl(id: String, label: String = "", colour: Variant = null) -> Dictionary:
	return _control(id, "crawl", label, colour)


## The button name for one direction of a dpad or crawl control: button_for("move", UP) is "move.up".
static func button_for(control_id: String, direction: String) -> String:
	return control_id + "." + direction


## An on/off toggle. Its value is a bool.
static func toggle(id: String, label: String = "", value: bool = false, colour: Variant = null) -> Dictionary:
	var c := _control(id, "toggle", label, colour)
	c["value"] = value
	return c


## A slider from 0 to 1. spring is where it returns when let go (0 to 1), or null to stay put.
static func slider(id: String, label: String = "", value: float = 0.0, vertical: bool = false, spring: Variant = null, colour: Variant = null) -> Dictionary:
	var c := _control(id, "slider", label, colour)
	c["value"] = value
	c["orientation"] = "vertical" if vertical else "horizontal"
	if spring != null:
		c["spring"] = float(spring)
	return c


## A choice of 2 to 4 options (up to 16 characters each). Its value is the chosen index, an int.
static func choice(id: String, options: Array, label: String = "", value: int = 0, colour: Variant = null) -> Dictionary:
	var c := _control(id, "choice", label, colour)
	var list: Array = []
	for o in options:
		list.append(str(o))
	c["options"] = list
	c["value"] = value
	return c


## Text shown on the phone (up to 80 characters), such as a score. Only apps change it.
static func label(id: String, label: String = "", text: String = "", colour: Variant = null) -> Dictionary:
	var c := _control(id, "label", label, colour)
	c["text"] = text
	return c


static func _control(id: String, type: String, label: String, colour: Variant) -> Dictionary:
	var c := {"id": id, "type": type}
	if label != "":
		c["label"] = label
	if colour is Color:
		c["colour"] = "#" + (colour as Color).to_html(false).to_lower()
	elif colour != null and str(colour) != "":
		c["colour"] = str(colour)
	return c
