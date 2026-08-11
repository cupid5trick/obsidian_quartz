repo=$1
rm -f content && ln -s $(realpath $repo) content
# Source build-time secrets (e.g. QUARTZ_ACL_PASSWORD) from a gitignored acl.env if present
if [ -f "$(dirname "$0")/acl.env" ]; then
  set -a
  . "$(dirname "$0")/acl.env"
  set +a
fi
npm i
npx quartz build --serve --port 1313
