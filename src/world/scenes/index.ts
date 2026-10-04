/**
 * Sample scenes for the world lab and the tests. Each is plain JSON (the SceneDef shape, docs/world.md), checked
 * by parseSceneDef when this module loads, so a typo fails loudly. Add a scene: drop a JSON file here and list it.
 */
import { parseSceneDef, type SceneDef } from "../scene";
import village from "./village.json";
import crossroads from "./crossroads.json";
import chapel from "./chapel.json";
import forest from "./forest.json";

/** The first scene is the default (the world lab, `mountScene` without a scene): the village, where act 1 starts. */
export const SCENES: readonly SceneDef[] = [village, crossroads, chapel, forest].map(parseSceneDef);

export const sceneById = (id: string): SceneDef | undefined => SCENES.find((s) => s.id === id);
