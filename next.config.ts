import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    sassOptions: {
        // Lets `.scss` files use bare imports rooted at the project, e.g.
        //   @use 'app/styles/mixins' as *;
        // Mirrors the `@/*` TS path alias in tsconfig.json.
        loadPaths: [path.resolve(process.cwd())],
    },
};

export default nextConfig;
