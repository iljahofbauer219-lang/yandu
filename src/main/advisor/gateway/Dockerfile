FROM node:22-bookworm-slim

WORKDIR /app
COPY server.mjs ./server.mjs
# Docker Engine control socket is owned by root on the target host. This control-plane
# container retains no Linux capabilities and is the only component granted that socket.
USER root
EXPOSE 8788
CMD ["node", "server.mjs"]
