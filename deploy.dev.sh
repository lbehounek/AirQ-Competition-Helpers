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

# Check if public_html directory exists
if [ ! -d "public_html" ]; then
    echo "❌ public_html directory not found."
    exit 1
fi

echo "📁 Deploying public_html/ to $DEV_HOST"
echo "📂 Target: $DEV_USER@$DEV_HOST:$DEV_REMOTE_DIR"

# Deploy using rsync (without --delete to preserve existing remote files)
rsync -avz public_html/ "$DEV_USER@$DEV_HOST:$DEV_REMOTE_DIR"

if [ $? -eq 0 ]; then
    echo "✅ Development deployment complete"
    echo "🌐 https://zavody.behounek.it"
else
    echo "❌ Deployment failed"
    exit 1
fi
