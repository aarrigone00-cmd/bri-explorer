// The flagship projects the Project Watcher checks: exactly the file the map
// shows, bundled into the function.
import projectsJson from '../../public/data/projects.json' with { type: 'json' };
import type { Project } from '../../src/types';

export const projects = projectsJson.projects as unknown as Project[];
