FROM node:22-bookworm AS build

WORKDIR /opt/deepseek-harness
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build
RUN node -e "const fs=require('fs'),path=require('path');const root=process.cwd(),scope=path.join(root,'node_modules','@deepseek-ai');fs.mkdirSync(scope,{recursive:true});const visit=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='node_modules')continue;const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else if(entry.name==='package.json'){const pkg=JSON.parse(fs.readFileSync(file,'utf8')).name;if(pkg?.startsWith('@deepseek-ai/')){const link=path.join(scope,pkg.slice('@deepseek-ai/'.length));if(!fs.existsSync(link))fs.symlinkSync(path.relative(scope,path.dirname(file)),link)}}}};for(const base of ['apps','packages','vendor'])visit(path.join(root,base))"

FROM build

COPY entrypoint.sh /usr/local/bin/deepseek-harness-entrypoint
COPY proxy.mjs /usr/local/lib/deepseek-harness-proxy.mjs
RUN chmod 0555 /usr/local/bin/deepseek-harness-entrypoint /usr/local/lib/deepseek-harness-proxy.mjs

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/deepseek-harness-entrypoint"]
