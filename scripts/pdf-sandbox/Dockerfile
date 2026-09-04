# Official Ubuntu multi-architecture manifest; refresh deliberately with security
# updates. The package floor includes USN-8400-1, not a claim of zero CVEs.
FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517 AS base
ARG SECURITY_REFRESH_DATE
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends poppler-utils python3 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' poppler-utils)" ge 24.02.0-1ubuntu9.9 \
    && rm -rf /var/lib/apt/lists/*
COPY boundary.py /opt/keel/boundary.py
ENV PATH=/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8
USER 65532:65532
WORKDIR /tmp
LABEL keel.pdf-sandbox.protocol="1"

# Adversarial probes are a separate test image, never in the reader image.
FROM base AS probe
COPY probe.py /opt/keel/reader.py
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "35", "/usr/bin/python3", "-I", "-B", "/opt/keel/reader.py"]

FROM base AS reader
COPY reader.py /opt/keel/reader.py
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "35", "/usr/bin/python3", "-I", "-B", "/opt/keel/reader.py"]
