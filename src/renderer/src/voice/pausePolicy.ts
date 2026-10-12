// Pausing is for the phone: a hidden page there is a locked screen or another tab, and the app never records out of sight. On the computer a window without focus
// keeps listening, with the open microphone shown. Pure on purpose: the hook passes the page's visibility.
export function pausePolicy(input: { phone: boolean; hidden: boolean }): 'pause' | 'keep' {
  return input.phone && input.hidden ? 'pause' : 'keep';
}
