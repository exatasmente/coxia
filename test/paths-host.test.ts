// The folders the app works in, as the host gives them: without a host everything sits where the data root says, and with a port filled the port
// answers for every folder. A port may arrive after this module loads, so every one of these is a call and never a constant.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_ROOT } from '../src/main/env';
import {
  claudeBin,
  isPackaged,
  legacyVenvDir,
  playwrightMcpCli,
  resourcesDir,
  setPathsPort,
  sidecarDir,
  userDataDir,
  voiceModelsDir,
  voiceToolsDir,
  voiceVenvDir,
} from '../src/main/paths';

const REPO = join(import.meta.dirname, '..');

afterEach(() => setPathsPort(null));

describe('without a host', () => {
  it('puts the user data under the data root and the voice folders inside it', () => {
    expect(userDataDir()).toBe(join(DATA_ROOT, 'userData'));
    expect(voiceVenvDir()).toBe(join(DATA_ROOT, 'userData', 'voice-venv'));
    expect(voiceModelsDir()).toBe(join(DATA_ROOT, 'userData', 'voice-models'));
    expect(voiceToolsDir()).toBe(join(DATA_ROOT, 'userData', 'voice-tools'));
  });

  it('reads the repository for what a development checkout ships', () => {
    expect(isPackaged()).toBe(false);
    expect(resourcesDir()).toBe(join(REPO, 'resources'));
    expect(sidecarDir()).toBe(join(REPO, 'sidecar'));
    expect(claudeBin()).toBeUndefined();
    expect(playwrightMcpCli()).toBe(join(REPO, 'node_modules/@playwright/mcp/cli.js'));
    expect(legacyVenvDir()).toBe(join(REPO, 'sidecar', '.venv'));
  });
});

describe('with the port of a host filled in', () => {
  it('answers every folder from the port, packed or not', () => {
    setPathsPort({ isPackaged: () => true, resources: () => '/opt/example/resources-base', userData: () => '/home/example/data' });
    expect(isPackaged()).toBe(true);
    expect(resourcesDir()).toBe('/opt/example/resources-base/resources');
    expect(sidecarDir()).toBe('/opt/example/resources-base/sidecar');
    expect(claudeBin()).toBe('/opt/example/resources-base/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude');
    expect(playwrightMcpCli()).toBe('/opt/example/resources-base/app.asar.unpacked/node_modules/@playwright/mcp/cli.js');
    expect(userDataDir()).toBe('/home/example/data');
    expect(voiceVenvDir()).toBe('/home/example/data/voice-venv');
    expect(voiceModelsDir()).toBe('/home/example/data/voice-models');
    expect(voiceToolsDir()).toBe('/home/example/data/voice-tools');
    expect(legacyVenvDir()).toBeNull();
  });

  it('keeps answering while it is filled and goes back to the defaults when it is taken away', () => {
    setPathsPort({ isPackaged: () => false, resources: () => '/opt/example/resources-base', userData: () => '/home/example/data' });
    expect(isPackaged()).toBe(false);
    expect(playwrightMcpCli()).toBe(join(REPO, 'node_modules/@playwright/mcp/cli.js'));
    setPathsPort(null);
    expect(userDataDir()).toBe(join(DATA_ROOT, 'userData'));
  });
});