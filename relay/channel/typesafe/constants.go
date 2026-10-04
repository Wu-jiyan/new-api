package typesafe

const ChannelName = "typesafe"

// ModelList lists the models TypeSafe serves from POST /v1/systemone. The
// aliases resolve to the same versioned model, so all three are published.
var ModelList = []string{
	"jev-latest",
	"jev-preview",
	"jev-1.13.0",
}
