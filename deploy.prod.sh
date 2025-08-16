#!/bin/bash

echo "🚧 Deploying to production server..."

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

echo "📁 Deploying public_html/ to $PROD_HOST"
echo "📂 Target: $PROD_USER@$PROD_HOST:$PROD_REMOTE_DIR"

# Deploy using rsync (without --delete to preserve existing remote files)
rsync -avz public_html/ "$PROD_USER@$PROD_HOST:$PROD_REMOTE_DIR"

if [ $? -eq 0 ]; then
    echo "✅ Production deployment complete"
    echo "🌐 https://javorovylist.cz"
else
    echo "❌ Deployment failed"
    exit 1
fi
