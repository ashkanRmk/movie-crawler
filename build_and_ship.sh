#!/usr/bin/env bash

set -e

########################################
# CONFIG — CHANGE THESE
########################################

SERVER_USER="root"
SERVER_HOST="178.239.151.59"
REMOTE_DIR="/tmp"

# IMPORTANT: match your server arch
PLATFORM="linux/amd64"
# PLATFORM="linux/arm64"

VERSION=${1:-"1.0.0"}

BACKEND_IMAGE="my-backend"
FRONTEND_IMAGE="my-frontend"
FRONTEND_API_BASE=${FRONTEND_API_BASE:-""}
REGISTRY=${REGISTRY:-"localhost:5000"}
BACKEND_REGISTRY_IMAGE="$REGISTRY/$BACKEND_IMAGE:$VERSION"
FRONTEND_REGISTRY_IMAGE="$REGISTRY/$FRONTEND_IMAGE:$VERSION"

########################################
# BUILD IMAGES (on Mac)
########################################

echo "🚀 Building images for platform: $PLATFORM (version: $VERSION)"

# docker buildx build \
#   --platform $PLATFORM \
#   -t $BACKEND_IMAGE:$VERSION \
#   --load \
#   ./backend

docker buildx build \
  --platform $PLATFORM \
  --build-arg VITE_API_BASE="$FRONTEND_API_BASE" \
  -t $FRONTEND_IMAGE:$VERSION \
  --load \
  ./frontend

########################################
# SAVE IMAGES
########################################

echo "📦 Saving images..."

# docker image save -o ${BACKEND_IMAGE}_${VERSION}.tar $BACKEND_IMAGE:$VERSION
docker image save -o ${FRONTEND_IMAGE}_${VERSION}.tar $FRONTEND_IMAGE:$VERSION

########################################
# COMPRESS
########################################

echo "🗜 Compressing..."

# gzip -f ${BACKEND_IMAGE}_${VERSION}.tar
gzip -f ${FRONTEND_IMAGE}_${VERSION}.tar

########################################
# TRANSFER TO SERVER
########################################

echo "📡 Copying to server..."

# scp ${BACKEND_IMAGE}_${VERSION}.tar.gz $SERVER_USER@$SERVER_HOST:$REMOTE_DIR/
scp ${FRONTEND_IMAGE}_${VERSION}.tar.gz $SERVER_USER@$SERVER_HOST:$REMOTE_DIR/

########################################
# LOAD ON SERVER
########################################

echo "📥 Loading images on server..."

ssh $SERVER_USER@$SERVER_HOST << EOF
  set -e

  echo "📂 Moving to $REMOTE_DIR"
  cd $REMOTE_DIR

  echo "📦 Extracting..."
  # gunzip -f ${BACKEND_IMAGE}_${VERSION}.tar.gz
  gunzip -f ${FRONTEND_IMAGE}_${VERSION}.tar.gz

  echo "🐳 Loading into Docker..."
  # docker image load -i ${BACKEND_IMAGE}_${VERSION}.tar
  docker image load -i ${FRONTEND_IMAGE}_${VERSION}.tar

  echo "🏷 Tagging images for registry: $REGISTRY"
  # docker tag $BACKEND_IMAGE:$VERSION $BACKEND_REGISTRY_IMAGE
  docker tag $FRONTEND_IMAGE:$VERSION $FRONTEND_REGISTRY_IMAGE

  echo "📤 Pushing images to registry..."
  # docker push $BACKEND_REGISTRY_IMAGE
  docker push $FRONTEND_REGISTRY_IMAGE

  echo "🧹 Cleanup..."
  # rm -f ${BACKEND_IMAGE}_${VERSION}.tar
  rm -f ${FRONTEND_IMAGE}_${VERSION}.tar

  echo "✅ Done. Available images:"
  docker image ls | grep -E "$BACKEND_IMAGE|$FRONTEND_IMAGE"
EOF

########################################
# DONE
########################################

echo ""
echo "🎉 SUCCESS!"
echo "Backend image:  $BACKEND_IMAGE:$VERSION"
echo "Frontend image: $FRONTEND_IMAGE:$VERSION"
echo "Backend registry image:  $BACKEND_REGISTRY_IMAGE"
echo "Frontend registry image: $FRONTEND_REGISTRY_IMAGE"
echo ""
echo "👉 Now go to Coolify and set:"
echo "   Image = $BACKEND_REGISTRY_IMAGE"
echo "   Image = $FRONTEND_REGISTRY_IMAGE"
if [ -n "$FRONTEND_API_BASE" ]; then
  echo "   Frontend API base = $FRONTEND_API_BASE"
else
  echo "   Frontend API base = same origin (/api)"
fi
