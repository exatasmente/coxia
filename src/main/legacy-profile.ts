import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseLegacyProfile, type LegacyProfile } from '../shared/config/legacy';
import { expandHome } from '../shared/config/paths';

export const LEGACY_PROFILE_ENV = 'COXIA_LEGACY_PROFILE';

/**
 * The optional profile of an install that predates the configuration: a JSON file the person keeps outside the repository, named by
 * COXIA_LEGACY_PROFILE. Null when the variable is unset, the file is missing or it is not a profile (the migration then uses the
 * neutral defaults); `log` says why in the last two cases.
 */
export function loadLegacyProfile(
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = () => {},
  read: (file: string) => string = (f) => readFileSync(f, 'utf8'),
  home: string = homedir(),
): LegacyProfile | null {
  const raw = env[LEGACY_PROFILE_ENV]?.trim();
  if (!raw) return null;
  const file = expandHome(raw, home);
  try {
    const profile = parseLegacyProfile(JSON.parse(read(file)));
    if (!profile) log(`${LEGACY_PROFILE_ENV}: ${file} is not a profile (an object with a "config" object); ignored`);
    return profile;
  } catch (e) {
    log(`${LEGACY_PROFILE_ENV}: cannot read ${file}: ${e instanceof Error ? e.message : String(e)}; ignored`);
    return null;
  }
}
