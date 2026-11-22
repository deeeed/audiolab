import { Skia } from '@shopify/react-native-skia'
import type { SkPath, SkPathBuilder } from '@shopify/react-native-skia'

type PathCommands = Pick<
    SkPathBuilder,
    'moveTo' | 'lineTo' | 'close' | 'addCircle' | 'addArc'
>

// Skia 2.14 removed SkPath's mutating methods in favour of PathBuilder, which
// only exists from 2.6; the peer range still reaches versions without it.
export function buildPath(draw: (path: PathCommands) => void): SkPath {
    const { PathBuilder } = Skia as Partial<Pick<typeof Skia, 'PathBuilder'>>
    if (PathBuilder) {
        const builder = PathBuilder.Make()
        draw(builder)
        return builder.detach()
    }
    const path = Skia.Path.Make()
    draw(path as unknown as PathCommands)
    return path
}
