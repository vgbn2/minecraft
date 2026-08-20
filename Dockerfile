FROM eclipse-temurin:21-jre-jammy

RUN useradd -r -m -s /bin/bash minecraft && \
    mkdir -p /opt/minecraft && \
    chown -R minecraft:minecraft /opt/minecraft

WORKDIR /opt/minecraft

ARG MC_VERSION=1.21.11
ARG PAPER_BUILD=132

ADD --chown=minecraft:minecraft \
  "https://fill-data.papermc.io/v1/objects/5ffef465eeeb5f2a3c23a24419d97c51afd7dbb4923ff42df9a3f58bba1ccfba/paper-${MC_VERSION}-${PAPER_BUILD}.jar" \
  server.jar

RUN echo "eula=true" > eula.txt && chown minecraft:minecraft eula.txt

USER minecraft

EXPOSE 25565
EXPOSE 25575

ENTRYPOINT ["java", \
  "-Xms2G", "-Xmx4G", \
  "-XX:+UseG1GC", \
  "-XX:+ParallelRefProcEnabled", \
  "-XX:MaxGCPauseMillis=200", \
  "-XX:+UnlockExperimentalVMOptions", \
  "-XX:+DisableExplicitGC", \
  "-XX:+AlwaysPreTouch", \
  "-XX:G1NewSizePercent=30", \
  "-XX:G1MaxNewSizePercent=40", \
  "-XX:G1HeapRegionSize=8M", \
  "-XX:G1ReservePercent=20", \
  "-XX:InitiatingHeapOccupancyPercent=15", \
  "-jar", "server.jar", "nogui"]
