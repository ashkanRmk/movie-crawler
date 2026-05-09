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

BUILD_BACKEND=false
BUILD_FRONTEND=false

usage() {
  cat <<USAGE
Usage: $0 [-b] [-f] [version]

Options:
  -b    Build and deploy backend only
  -f    Build and deploy frontend only
  -h    Show this help

If neither -b nor -f is provided, both backend and frontend are built and deployed.
USAGE
}

while getopts ":bfh" opt; do
  case "$opt" in
    b) BUILD_BACKEND=true ;;
    f) BUILD_FRONTEND=true ;;
    h) usage; exit 0 ;;
    \?) echo "Unknown option: -$OPTARG" >&2; usage >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

VERSION=${1:-"1.0.0"}

if [ "$BUILD_BACKEND" = false ] && [ "$BUILD_FRONTEND" = false ]; then
  BUILD_BACKEND=true
  BUILD_FRONTEND=true
fi

BACKEND_IMAGE="my-backend"
FRONTEND_IMAGE="my-frontend"
FRONTEND_API_BASE="https://3kans-back.devsquad.ir"
REGISTRY=${REGISTRY:-"localhost:5000"}
BACKEND_REGISTRY_IMAGE="$REGISTRY/$BACKEND_IMAGE:$VERSION"
FRONTEND_REGISTRY_IMAGE="$REGISTRY/$FRONTEND_IMAGE:$VERSION"

########################################
# BUILD IMAGES (on Mac)
########################################

echo "🚀 Building images for platform: $PLATFORM (version: $VERSION)"

if [ "$BUILD_BACKEND" = true ]; then
  docker buildx build \
    --platform $PLATFORM \
    -t $BACKEND_IMAGE:$VERSION \
    --load \
    ./backend
fi

if [ "$BUILD_FRONTEND" = true ]; then
  docker buildx build \
    --platform $PLATFORM \
    --build-arg VITE_API_BASE="$FRONTEND_API_BASE" \
    -t $FRONTEND_IMAGE:$VERSION \
    --load \
    ./frontend
fi

########################################
# SAVE IMAGES
########################################

echo "📦 Saving images..."

if [ "$BUILD_BACKEND" = true ]; then
  docker image save -o ${BACKEND_IMAGE}_${VERSION}.tar $BACKEND_IMAGE:$VERSION
fi
if [ "$BUILD_FRONTEND" = true ]; then
  docker image save -o ${FRONTEND_IMAGE}_${VERSION}.tar $FRONTEND_IMAGE:$VERSION
fi

########################################
# COMPRESS
########################################

echo "🗜 Compressing..."

if [ "$BUILD_BACKEND" = true ]; then
  gzip -f ${BACKEND_IMAGE}_${VERSION}.tar
fi
if [ "$BUILD_FRONTEND" = true ]; then
  gzip -f ${FRONTEND_IMAGE}_${VERSION}.tar
fi

########################################
# TRANSFER TO SERVER
########################################

echo "📡 Copying to server..."

if [ "$BUILD_BACKEND" = true ]; then
  scp ${BACKEND_IMAGE}_${VERSION}.tar.gz $SERVER_USER@$SERVER_HOST:$REMOTE_DIR/
fi
if [ "$BUILD_FRONTEND" = true ]; then
  scp ${FRONTEND_IMAGE}_${VERSION}.tar.gz $SERVER_USER@$SERVER_HOST:$REMOTE_DIR/
fi

########################################
# LOAD ON SERVER
########################################

echo "📥 Loading images on server..."

ssh $SERVER_USER@$SERVER_HOST << EOF_REMOTE
  set -e

  echo "📂 Moving to $REMOTE_DIR"
  cd $REMOTE_DIR

  echo "📦 Extracting..."
EOF_REMOTE

if [ "$BUILD_BACKEND" = true ]; then
  ssh $SERVER_USER@$SERVER_HOST << EOF_REMOTE
  set -e
  cd $REMOTE_DIR
  gunzip -f ${BACKEND_IMAGE}_${VERSION}.tar.gz
  docker image load -i ${BACKEND_IMAGE}_${VERSION}.tar
  docker tag $BACKEND_IMAGE:$VERSION $BACKEND_REGISTRY_IMAGE
  docker push $BACKEND_REGISTRY_IMAGE
  rm -f ${BACKEND_IMAGE}_${VERSION}.tar
EOF_REMOTE
fi

if [ "$BUILD_FRONTEND" = true ]; then
  ssh $SERVER_USER@$SERVER_HOST << EOF_REMOTE
  set -e
  cd $REMOTE_DIR
  gunzip -f ${FRONTEND_IMAGE}_${VERSION}.tar.gz
  docker image load -i ${FRONTEND_IMAGE}_${VERSION}.tar
  docker tag $FRONTEND_IMAGE:$VERSION $FRONTEND_REGISTRY_IMAGE
  docker push $FRONTEND_REGISTRY_IMAGE
  rm -f ${FRONTEND_IMAGE}_${VERSION}.tar
EOF_REMOTE
fi

ssh $SERVER_USER@$SERVER_HOST << EOF_REMOTE
  set -e
  echo "✅ Done. Available images:"
  docker image ls | grep -E "$BACKEND_IMAGE|$FRONTEND_IMAGE"
EOF_REMOTE

########################################
# DONE
########################################

echo ""
echo "🎉 SUCCESS!"
if [ "$BUILD_BACKEND" = true ]; then
  echo "Backend image:  $BACKEND_IMAGE:$VERSION"
  echo "Backend registry image:  $BACKEND_REGISTRY_IMAGE"
fi
if [ "$BUILD_FRONTEND" = true ]; then
  echo "Frontend image: $FRONTEND_IMAGE:$VERSION"
  echo "Frontend registry image: $FRONTEND_REGISTRY_IMAGE"
fi
echo ""
echo "👉 Now go to Coolify and set:"
if [ "$BUILD_BACKEND" = true ]; then
  echo "   Backend Image = $BACKEND_REGISTRY_IMAGE"
fi
if [ "$BUILD_FRONTEND" = true ]; then
  echo "   Frontend Image = $FRONTEND_REGISTRY_IMAGE"
  if [ -n "$FRONTEND_API_BASE" ]; then
    echo "   Frontend API base = $FRONTEND_API_BASE"
  else
    echo "   Frontend API base = same origin (/api)"
  fi
fi
