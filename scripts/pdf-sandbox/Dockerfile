# Official Ubuntu multi-architecture manifest; refresh deliberately with security
# updates. The package floor includes USN-8400-1, not a claim of zero CVEs.
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS certificates

FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517 AS base
ARG SECURITY_REFRESH_DATE
COPY --from=certificates /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt
RUN sed -i 's|URIs: http://|URIs: https://|g' /etc/apt/sources.list.d/ubuntu.sources \
    && ! grep -q '^URIs: http://' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates poppler-utils python3 \
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

# Signature refresh is an explicit maintenance/build step. The runtime scanner
# has no network and refuses vendor databases older than 72 hours.
FROM base AS scanner
USER root
RUN apt-get update && apt-get install -y --no-install-recommends clamav clamav-freshclam \
    && rm -rf /var/lib/apt/lists/*
COPY freshclam.conf /opt/keel/freshclam.conf
RUN freshclam --config-file=/opt/keel/freshclam.conf --stdout
COPY scanner.py /opt/keel/scanner.py
USER 65532:65532
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "95", "/usr/bin/python3", "-I", "-B", "/opt/keel/scanner.py"]

FROM base AS reader
COPY reader.py /opt/keel/reader.py
ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "35", "/usr/bin/python3", "-I", "-B", "/opt/keel/reader.py"]
