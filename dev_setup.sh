repo=$1
rm -f content && ln -s $(realpath $repo) content
npm i
npx quartz build --serve --port 1313
