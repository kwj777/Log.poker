/**
 * What a rendering test has to stand in for, and nothing else.
 *
 * `@expo/vector-icons` reaches `expo-font`, which requires `expo-asset`, which
 * this project does not install: Metro resolves it through Expo's own tree and
 * Jest resolves like Node, so the import that is fine in a build is missing
 * here. The icons are decorative in every screen that uses them -- they sit
 * beside a label, never instead of one -- so nothing under test depends on
 * what they draw, and adding a dependency to satisfy a resolver would be the
 * wrong way round.
 */

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));
