// The site's own theme file. It exists so the folder carries one place for the visual work to happen later: the
// site is another project with its own look, and it does not use the renderer's theme tokens.
import DefaultTheme from 'vitepress/theme';

export default {
  extends: DefaultTheme,
};
