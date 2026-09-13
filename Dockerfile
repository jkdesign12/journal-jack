# journal.io — no dependencies, so no install step and no build step.
# node:sqlite (built into Node 22.5+) is what stores accounts and journals.
FROM node:24-alpine

WORKDIR /app
COPY . .

# accounts, journal documents and uploaded files land here; mount a volume on it
ENV DATA_DIR=/data
ENV PORT=8080
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "server.js"]
