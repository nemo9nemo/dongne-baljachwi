FROM node:22-alpine
RUN apk add --no-cache su-exec && mkdir -p /app/scripts/sharing /data
WORKDIR /app
COPY scripts/sharing/ scripts/sharing/
COPY deploy/sharing/entrypoint.sh /usr/local/bin/sharing-entrypoint
RUN chmod 755 /usr/local/bin/sharing-entrypoint
ENV NODE_ENV=production SHARE_HOST=0.0.0.0 SHARE_STATE_PATH=/data/share-connections.json
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SHARE_PORT||process.env.PORT||8787)+'/api/device-share/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/sharing-entrypoint"]
CMD ["node", "scripts/sharing/serve.mjs"]
