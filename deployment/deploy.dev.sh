#!/bin/bash

echo "🚧 Deploying to development server..."

# Check if deploy.conf exists
if [ ! -f "deploy.conf" ]; then
    echo "❌ Configuration file deploy.conf not found."
    echo "Please copy deploy.conf.example to deploy.conf and fill in your details."
    exit 1
fi

# Source the configuration
source deploy.conf

APP_NAME="$1" # optional: e.g., map-corridors or photo-helper

build_and_stage() {
    local app="$1"
    local app_dir="frontend/$app"
    local subdir="public_html/$app"

    if [ ! -d "$app_dir" ]; then
        echo "❌ Unknown app: $app (directory $app_dir not found)"
        exit 1
    fi

    echo "🛠  Building $app..."
    (cd "$app_dir" && npm run -s build) || { echo "❌ Build failed for $app"; exit 1; }

    echo "📦 Staging $app build to $subdir"
    mkdir -p "$subdir"
    rsync -avz "$app_dir/dist/" "$subdir/" || { echo "❌ Staging failed for $app"; exit 1; }
}

# Stage the landing page (frontend/index.html) into public_html root
stage_landing() {
    local landing_src="frontend/index.html"
    local landing_dst="public_html/index.html"
    if [ -f "$landing_src" ]; then
        echo "🗂  Staging landing page to $landing_dst"
        mkdir -p "public_html"
        rsync -avz "$landing_src" "$landing_dst" || { echo "❌ Staging landing page failed"; exit 1; }
    else
        echo "ℹ️  Landing page $landing_src not found; skipping."
    fi
}

if [ -n "$APP_NAME" ]; then
    # Build and deploy only the specified app to its subfolder
    build_and_stage "$APP_NAME"
    stage_landing

    echo "📁 Deploying $APP_NAME/ to $DEV_HOST"
    echo "📂 Target: $DEV_USER@$DEV_HOST:${DEV_REMOTE_DIR}${APP_NAME}/"
    rsync -avz "public_html/$APP_NAME/" "$DEV_USER@$DEV_HOST:${DEV_REMOTE_DIR}${APP_NAME}/"
    if [ $? -eq 0 ]; then
        echo "✅ Development deployment complete"
        echo "🌐 ${DEV_URL}/$APP_NAME/"
        # Deploy landing page index.html to the remote root as well
        if [ -f "public_html/index.html" ]; then
            echo "📄 Deploying landing page to $DEV_HOST root"
            rsync -avz "public_html/index.html" "$DEV_USER@$DEV_HOST:${DEV_REMOTE_DIR}"
            if [ $? -eq 0 ]; then
                echo "🌐 ${DEV_URL}/"
            else
                echo "⚠️  Landing page deployment failed (app deployed successfully)."
            fi
        fi
        exit 0
    else
        echo "❌ Deployment failed"
        exit 1
    fi
else
    # No app specified: deploy entire public_html as before
    if [ ! -d "public_html" ]; then
        echo "❌ public_html directory not found."
        exit 1
    fi
    # Ensure landing page is staged before full deploy
    stage_landing
    echo "📁 Deploying public_html/ to $DEV_HOST"
    echo "📂 Target: $DEV_USER@$DEV_HOST:$DEV_REMOTE_DIR"
    rsync -avz public_html/ "$DEV_USER@$DEV_HOST:$DEV_REMOTE_DIR"
    if [ $? -eq 0 ]; then
        echo "✅ Development deployment complete"
        echo "🌐 ${DEV_URL}"
    else
        echo "❌ Deployment failed"
        exit 1
    fi
fi
