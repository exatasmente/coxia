import { main } from './main';

// The file the bundle is built from: runs the entry on the process's own arguments. Kept apart so a test can import `main` without starting anything.
void main(process.argv.slice(2), process.env);
