// SPDX-License-Identifier: GPL-3.0-or-later
// SAAM adapter for unmodified CGAL 6.2.1. See README.md for dependency licenses.
#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Exact_predicates_exact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/IO/polygon_soup_io.h>
#include <CGAL/Polygon_mesh_processing/orient_polygon_soup.h>
#include <CGAL/Polygon_mesh_processing/polygon_soup_to_polygon_mesh.h>
#include <CGAL/Polygon_mesh_processing/stitch_borders.h>
#include <CGAL/Polygon_mesh_processing/triangulate_hole.h>
#include <CGAL/Polygon_mesh_processing/autorefinement.h>
#include <CGAL/Polygon_mesh_processing/self_intersections.h>
#include <CGAL/Polygon_mesh_processing/measure.h>
#include <CGAL/boost/graph/border.h>
#include <CGAL/boost/graph/Euler_operations.h>
#include <CGAL/version.h>
#include <algorithm>
#include <array>
#include <cstdint>
#include <chrono>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <sstream>
namespace PMP=CGAL::Polygon_mesh_processing;
using K=CGAL::Exact_predicates_inexact_constructions_kernel;
using EK=CGAL::Exact_predicates_exact_constructions_kernel;
using Mesh=CGAL::Surface_mesh<K::Point_3>;
using Triangle=std::array<std::size_t,3>;
void stage(const char* name){std::cerr<<"{\"stage\":\""<<name<<"\"}\n";}

struct Face{Triangle v;int weight;};
struct Node{CGAL::Bbox_3 box;std::size_t first,count,left,right;};
struct Bvh{
 std::vector<Node> nodes;std::vector<std::size_t> order;
 std::size_t build(const std::vector<CGAL::Bbox_3>& boxes,std::size_t first,std::size_t count){
  CGAL::Bbox_3 box;for(std::size_t i=first;i<first+count;++i)box+=boxes[order[i]];
  const std::size_t id=nodes.size();nodes.push_back({box,first,count,0,0});
  if(count<=8)return id;
  const double span[3]={box.xmax()-box.xmin(),box.ymax()-box.ymin(),box.zmax()-box.zmin()};
  const int axis=span[0]>=span[1]&&span[0]>=span[2]?0:span[1]>=span[2]?1:2;
  std::nth_element(order.begin()+first,order.begin()+first+count/2,order.begin()+first+count,[&](std::size_t a,std::size_t b){
   return boxes[a].min(axis)+boxes[a].max(axis)<boxes[b].min(axis)+boxes[b].max(axis);});
  const std::size_t left=build(boxes,first,count/2),right=build(boxes,first+count/2,count-count/2);
  nodes[id].left=left;nodes[id].right=right;nodes[id].count=0;return id;
 }
};
// Conservative double test: the exact segment lies within the margin of its
// rounded endpoints, so a missed box cannot hold a crossing.
bool segmentMeetsBox(const double a[3],const double b[3],const CGAL::Bbox_3& box,double margin){
 double lo=0,hi=1;
 for(int k=0;k<3;++k){
  const double d=b[k]-a[k],min=box.min(k)-margin,max=box.max(k)+margin;
  if(d==0){if(a[k]<min||a[k]>max)return false;continue;}
  double t0=(min-a[k])/d,t1=(max-a[k])/d;if(t0>t1)std::swap(t0,t1);
  lo=std::max(lo,t0);hi=std::min(hi,t1);if(lo>hi)return false;
 }
 return true;
}

// SAAM's mesh contract (core/geom/mesh.mjs triangleNormal) needs every triangle's
// smallest height above numeric conditioning, 1e-9 mm (core/dimensions.mjs).
// Arrangement corners can leave flatter triangles: each loses its shortest edge
// with a constructed end, which moves onto the other end. Source vertices stay.
struct Collapse{std::size_t edges=0,remaining=0;double maxMoveMm=0;};
Collapse collapseTinyTriangles(Mesh& mesh,std::vector<K::Point_3> source){
 std::sort(source.begin(),source.end());
 const auto isSource=[&](Mesh::Vertex_index v){return std::binary_search(source.begin(),source.end(),mesh.point(v));};
 const auto tiny=[&](Mesh::Face_index f){
  const auto h=mesh.halfedge(f);const auto& a=mesh.point(mesh.source(h));const auto& b=mesh.point(mesh.target(h));const auto& c=mesh.point(mesh.target(mesh.next(h)));
  const double u[3]={b.x()-a.x(),b.y()-a.y(),b.z()-a.z()},v[3]={c.x()-a.x(),c.y()-a.y(),c.z()-a.z()};
  const double w[3]={c.x()-b.x(),c.y()-b.y(),c.z()-b.z()},longest=std::sqrt(std::max({u[0]*u[0]+u[1]*u[1]+u[2]*u[2],v[0]*v[0]+v[1]*v[1]+v[2]*v[2],w[0]*w[0]+w[1]*w[1]+w[2]*w[2]}));
  return std::hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<=1e-9*longest;
 };
 Collapse out;
 for(bool changed=true;changed;){
  changed=false;
  for(auto f:mesh.faces()){
   if(mesh.is_removed(f)||!tiny(f))continue;
   Mesh::Halfedge_index best;double length=INFINITY;
   for(auto h:CGAL::halfedges_around_face(mesh.halfedge(f),mesh))for(auto g:{h,mesh.opposite(h)}){
    if(isSource(mesh.source(g)))continue;
    const double l=std::sqrt(CGAL::squared_distance(mesh.point(mesh.source(g)),mesh.point(mesh.target(g))));
    if(l<length&&CGAL::Euler::does_satisfy_link_condition(mesh.edge(g),mesh)){best=g;length=l;}
   }
   if(!(length<INFINITY))continue;
   const auto keep=mesh.point(mesh.target(best));
   mesh.point(CGAL::Euler::collapse_edge(mesh.edge(best),mesh))=keep;
   ++out.edges;out.maxMoveMm=std::max(out.maxMoveMm,length);changed=true;
  }
 }
 for(auto f:mesh.faces())if(tiny(f))++out.remaining;
 return out;
}

// Opposed sheets of the source closer than closeMm (print resolution), in any
// orientation, would reconstruct as a film below print resolution that thins to
// knife edges: a cut cap over a cavity floor a few micrometres away. Faces that
// face each other or away, lie within closeMm of each other's planes and come
// within closeMm form groups, joined through shared vertices of seeded faces that
// are coplanar within closeMm. Each group's vertices move onto one plane near the
// one fitted to its seeds, so refinement makes the sheets coincide and opposed
// copies cancel. A vertex moves at most closeMm and only for its largest group.
// The plane is x[k] = (si*x[i] + sj*x[j] + t) / 2^q with integers si, sj, t and k
// the normal's dominant axis; a moved vertex has x[i], x[j] on a 2^-grid lattice (where
// its slope is not zero), so x[k] is a double: moved points stay exactly coplanar
// doubles and refinement constructs from source-precision coordinates. A plane
// within closeMm/16 of an axis plane over the part is that axis plane.
struct Closing{std::size_t groups=0,faces=0,moved=0,unmoved=0;double maxMoveMm=0;};
struct GridPlane{int k,i,j;long long si,sj,t;};
Closing closeOpposedSheets(const Mesh& mesh,std::vector<EK::Point_3>& points,double closeMm){
 Closing out;if(!(closeMm>0))return out;
 const std::size_t n=mesh.number_of_faces();
 std::vector<Triangle> tri(n);std::vector<K::Triangle_3> shape(n);std::vector<K::Vector_3> normal(n);std::vector<double> area(n);std::vector<CGAL::Bbox_3> boxes(n);
 std::vector<std::vector<std::size_t>> incident(mesh.number_of_vertices());
 std::size_t i=0;
 for(auto f:mesh.faces()){
  const auto h=mesh.halfedge(f);tri[i]={mesh.source(h).idx(),mesh.target(h).idx(),mesh.target(mesh.next(h)).idx()};
  const auto& a=mesh.point(Mesh::Vertex_index(tri[i][0]));const auto& b=mesh.point(Mesh::Vertex_index(tri[i][1]));const auto& c=mesh.point(Mesh::Vertex_index(tri[i][2]));
  const K::Vector_3 v=CGAL::cross_product(b-a,c-a);const double l=std::sqrt(v.squared_length());
  shape[i]=K::Triangle_3(a,b,c);normal[i]=l>0?v/l:v;area[i]=l/2;
  const auto box=a.bbox()+b.bbox()+c.bbox();
  boxes[i]=CGAL::Bbox_3(box.xmin()-closeMm,box.ymin()-closeMm,box.zmin()-closeMm,box.xmax()+closeMm,box.ymax()+closeMm,box.zmax()+closeMm);
  for(auto v:tri[i])incident[v].push_back(i);++i;
 }
 const auto withinPlane=[&](std::size_t f,std::size_t g){
  for(auto [p,q]:{std::pair{f,g},std::pair{g,f}})for(auto v:tri[q])
   if(std::abs(normal[p]*(mesh.point(Mesh::Vertex_index(v))-shape[p][0]))>closeMm)return false;
  return true;
 };
 Bvh bvh;bvh.order.resize(n);std::iota(bvh.order.begin(),bvh.order.end(),0);if(n)bvh.build(boxes,0,n);
 std::vector<std::size_t> parent(n);std::iota(parent.begin(),parent.end(),0);
 const auto root=[&](std::size_t x){while(parent[x]!=x)x=parent[x]=parent[parent[x]];return x;};
 std::vector<char> seeded(n,0);
 for(std::size_t f=0;f<n;++f){
  std::vector<std::size_t> stack{0};
  while(!stack.empty()){
   const Node& node=bvh.nodes[stack.back()];stack.pop_back();
   if(!CGAL::do_overlap(node.box,boxes[f]))continue;
   if(node.count==0){stack.push_back(node.left);stack.push_back(node.right);continue;}
   for(std::size_t k=node.first;k<node.first+node.count;++k){
    const std::size_t g=bvh.order[k];
    if(g<=f||normal[f]*normal[g]>=0||!CGAL::do_overlap(boxes[f],boxes[g]))continue;
    if(std::any_of(tri[f].begin(),tri[f].end(),[&](std::size_t v){return std::find(tri[g].begin(),tri[g].end(),v)!=tri[g].end();}))continue;
    if(!withinPlane(f,g)||CGAL::squared_distance(shape[f],shape[g])>closeMm*closeMm)continue;
    parent[root(f)]=root(g);seeded[f]=seeded[g]=1;
   }
  }
 }
 for(const auto& faces:incident)for(std::size_t a=0;a<faces.size();++a)for(std::size_t b=a+1;b<faces.size();++b)
  if(seeded[faces[a]]&&seeded[faces[b]]&&withinPlane(faces[a],faces[b]))parent[root(faces[a])]=root(faces[b]);
 std::vector<std::vector<std::size_t>> groups(n);std::vector<double> groupArea(n,0);
 for(std::size_t f=0;f<n;++f)if(seeded[f]){groups[root(f)].push_back(f);groupArea[root(f)]+=area[f];}
 std::vector<std::size_t> order;for(std::size_t r=0;r<n;++r)if(!groups[r].empty())order.push_back(r);
 std::sort(order.begin(),order.end(),[&](std::size_t a,std::size_t b){return groupArea[a]!=groupArea[b]?groupArea[a]>groupArea[b]:a<b;});
 // Largest group first, each grows from its seeds over vertex-sharing faces lying
 // within closeMm of its plane (fitted to its seeds, from unmoved points),
 // so a sheet near one plane, such as a whole cut face, closes onto one plane.
 std::vector<long> owner(n,-1);std::vector<GridPlane> planes;
 // |x| < 2^e over the part. Slopes resolve 2^-q, so a plane strays at most
 // closeMm/16 across the part; |si*mi|, |sj*mj|, |t| < 2^(e+grid+q) = 2^50 keep x[k] exact.
 double reach=0;for(auto v:mesh.vertices())for(int c=0;c<3;++c)reach=std::max(reach,std::abs(mesh.point(v)[c]));
 const int e=reach>0?std::ilogb(reach)+1:0,q=e+5+int(std::ceil(std::log2(1/closeMm))),grid=50-e-q;
 for(auto r:order){
  const std::size_t best=*std::max_element(groups[r].begin(),groups[r].end(),[&](std::size_t a,std::size_t b){return area[a]<area[b];});
  // The plane fits the seeds (area-weighted normal and centroid).
  K::Vector_3 sum(0,0,0),centre(0,0,0);double weight=0;
  for(auto f:groups[r]){sum=sum+(normal[f]*normal[best]>=0?area[f]:-area[f])*normal[f];
   centre=centre+area[f]*((shape[f][0]-CGAL::ORIGIN)+(shape[f][1]-CGAL::ORIGIN)+(shape[f][2]-CGAL::ORIGIN))/3;weight+=area[f];}
  const K::Vector_3 unit=sum/std::sqrt(sum.squared_length());const K::Point_3 at=CGAL::ORIGIN+centre/weight;
  const int a=std::abs(unit.x())>=std::abs(unit.y())&&std::abs(unit.x())>=std::abs(unit.z())?0:std::abs(unit.y())>=std::abs(unit.z())?1:2;
  GridPlane plane{a,(a+1)%3,(a+2)%3,0,0,0};
  plane.si=std::llround(std::ldexp(-unit[plane.i]/unit[a],q));plane.sj=std::llround(std::ldexp(-unit[plane.j]/unit[a],q));
  plane.t=std::llround(std::ldexp(at[a]-std::ldexp(double(plane.si),-q)*at[plane.i]-std::ldexp(double(plane.sj),-q)*at[plane.j],grid+q));
  const long k=long(planes.size());planes.push_back(plane);
  const auto near=[&](std::size_t g){for(auto v:tri[g])if(std::abs(unit*(mesh.point(Mesh::Vertex_index(v))-at))>closeMm)return false;return true;};
  std::vector<std::size_t> queue;
  for(auto f:groups[r])if(owner[f]<0&&near(f)){owner[f]=k;queue.push_back(f);}
  if(queue.empty())continue;
  ++out.groups;
  while(!queue.empty()){const auto f=queue.back();queue.pop_back();++out.faces;
   for(auto v:tri[f])for(auto g:incident[v])if(owner[g]<0&&near(g)){owner[g]=k;queue.push_back(g);}}
 }
 std::vector<long> vertexGroup(points.size(),-1);
 for(std::size_t f=0;f<n;++f)if(owner[f]>=0)for(auto v:tri[f])if(vertexGroup[v]<0||owner[f]<vertexGroup[v])vertexGroup[v]=owner[f];
 for(std::size_t v=0;v<points.size();++v)if(vertexGroup[v]>=0){
  const auto& plane=planes[vertexGroup[v]];const auto& p=mesh.point(Mesh::Vertex_index(v));
  // Orthogonal projection (in doubles), then the grid and the exact x[k].
  const double si=std::ldexp(double(plane.si),-q),sj=std::ldexp(double(plane.sj),-q);
  const double off=(p[plane.k]-si*p[plane.i]-sj*p[plane.j]-std::ldexp(double(plane.t),-grid-q))/(1+si*si+sj*sj);
  double x[3];x[plane.k]=0;
  const auto onGrid=[&](int c,long long s,double y){if(s==0){x[c]=p[c];return 0LL;}const long long m=std::llround(std::ldexp(y,grid));x[c]=std::ldexp(double(m),-grid);return m;};
  const long long mi=onGrid(plane.i,plane.si,p[plane.i]+off*si),mj=onGrid(plane.j,plane.sj,p[plane.j]+off*sj);
  x[plane.k]=std::ldexp(double(plane.si*mi+plane.sj*mj+plane.t),-grid-q);
  const double move=std::sqrt((x[0]-p[0])*(x[0]-p[0])+(x[1]-p[1])*(x[1]-p[1])+(x[2]-p[2])*(x[2]-p[2]));
  if(move>closeMm){++out.unmoved;continue;}
  if(move>0){points[v]=EK::Point_3(x[0],x[1],x[2]);++out.moved;out.maxMoveMm=std::max(out.maxMoveMm,move);}
 }
 return out;
}

// Replaces a closed oriented surface that crosses itself by the boundary of
// its solid and returns the report. Exact autorefinement splits triangles along
// every crossing, so refined triangles meet only at shared edges and vertices.
// The solid is where the winding number w is positive: overlapping shells
// unite, inward-facing shells keep their cavities. A refined triangle is kept,
// facing w<=0, exactly when w>0 on one side only. Rounding to doubles follows
// classification because coincident refined triangles carry winding weight.
std::string reconstruct(Mesh& mesh,double closeMm){
 std::size_t coincident=0,cancelled=0,patches=0,rays=0,retries=0,interior=0;double cancelledArea=0;
 std::vector<K::Point_3> source(mesh.points().begin(),mesh.points().end());
 std::vector<EK::Point_3> points;points.reserve(source.size());
 for(const auto& p:source)points.emplace_back(p.x(),p.y(),p.z());
 stage("close");
 const Closing closing=closeOpposedSheets(mesh,points,closeMm);
 // Moved vertices are no longer source coordinates for the collapse below.
 if(closing.moved){std::vector<K::Point_3> kept;for(std::size_t v=0;v<source.size();++v)
  if(points[v]==EK::Point_3(source[v].x(),source[v].y(),source[v].z()))kept.push_back(source[v]);source.swap(kept);}
 // An inside-out file encloses negative volume; reversing it keeps the solid w>0.
 const bool reversed=PMP::volume(mesh)<0;
 std::vector<Triangle> soup;soup.reserve(mesh.number_of_faces());
 for(auto f:mesh.faces()){
  auto h=mesh.halfedge(f);Triangle t{mesh.target(h).idx(),mesh.target(mesh.next(h)).idx(),mesh.target(mesh.next(mesh.next(h))).idx()};
  if(reversed)std::swap(t[1],t[2]);soup.push_back(t);
 }
 stage("refine");
 PMP::autorefine_triangle_soup(points,soup);
 const std::size_t refined=soup.size();

 // Coincident refined triangles add their orientations; net zero is no surface.
 stage("classify");
 std::vector<std::pair<Triangle,int>> keyed;keyed.reserve(soup.size());
 for(const auto& t:soup){
  Triangle s=t;std::sort(s.begin(),s.end());
  keyed.push_back({s,(t[0]==s[0]&&t[1]==s[1])||(t[0]==s[1]&&t[1]==s[2])||(t[0]==s[2]&&t[1]==s[0])?1:-1});
 }
 soup.clear();soup.shrink_to_fit();
 std::sort(keyed.begin(),keyed.end());
 std::vector<Face> faces;
 for(std::size_t i=0;i<keyed.size();){
  std::size_t j=i;int net=0;while(j<keyed.size()&&keyed[j].first==keyed[i].first)net+=keyed[j++].second;
  if(j-i>1)++coincident;
  const Triangle& s=keyed[i].first;
  if(net>0)faces.push_back({s,net});else if(net<0)faces.push_back({{s[0],s[2],s[1]},-net});
  else{cancelled+=j-i;cancelledArea+=double(j-i)*std::sqrt(CGAL::to_double(CGAL::squared_area(points[s[0]],points[s[1]],points[s[2]])));}
  i=j;
 }
 keyed.clear();keyed.shrink_to_fit();
 if(faces.empty())throw std::runtime_error("Solid reconstruction encloses no volume; no result accepted");

 // Patches: faces joined across edges that only they share, with matching
 // orientation and weight, have the same winding on each side.
 struct Edge{std::size_t a,b,face;int direction;};
 std::vector<Edge> edges;edges.reserve(faces.size()*3);
 for(std::size_t f=0;f<faces.size();++f)for(int k=0;k<3;++k){
  const auto u=faces[f].v[k],v=faces[f].v[(k+1)%3];edges.push_back({std::min(u,v),std::max(u,v),f,u<v?1:-1});
 }
 std::sort(edges.begin(),edges.end(),[](const Edge& x,const Edge& y){return x.a!=y.a?x.a<y.a:x.b!=y.b?x.b<y.b:x.face<y.face;});
 std::vector<std::size_t> parent(faces.size());std::iota(parent.begin(),parent.end(),0);
 const auto root=[&](std::size_t x){while(parent[x]!=x)x=parent[x]=parent[parent[x]];return x;};
 for(std::size_t i=0;i<edges.size();){
  std::size_t j=i;long balance=0;
  while(j<edges.size()&&edges[j].a==edges[i].a&&edges[j].b==edges[i].b){balance+=long(edges[j].direction)*faces[edges[j].face].weight;++j;}
  if(balance!=0)throw std::runtime_error("Solid reconstruction needs a closed surface, but refined edges are unbalanced; no result accepted");
  if(j-i==2&&edges[i].direction!=edges[i+1].direction&&faces[edges[i].face].weight==faces[edges[i+1].face].weight)
   parent[root(edges[i].face)]=root(edges[i+1].face);
  i=j;
 }
 edges.clear();edges.shrink_to_fit();

 std::vector<CGAL::Bbox_3> boxes(faces.size());CGAL::Bbox_3 all;
 for(std::size_t f=0;f<faces.size();++f){boxes[f]=points[faces[f].v[0]].bbox()+points[faces[f].v[1]].bbox()+points[faces[f].v[2]].bbox();all+=boxes[f];}
 Bvh bvh;bvh.order.resize(faces.size());std::iota(bvh.order.begin(),bvh.order.end(),0);bvh.build(boxes,0,faces.size());
 double size=0;for(int k=0;k<3;++k)size=std::max(size,all.max(k)-all.min(k));
 const double reach=4*size+1,margin=1e-9*(size+1);
 double centre[3];for(int k=0;k<3;++k)centre[k]=(all.min(k)+all.max(k))/2;

 // Winding on the side of face f that faces q, from the signed crossings of
 // segment centroid->q (w(q)=0 outside). Returns false when the segment meets
 // an edge, vertex or plane degenerately; the caller then tries another q.
 const auto windingToward=[&](std::size_t f,const EK::Point_3& q,long& winding){
  const auto& t=faces[f].v;
  const EK::Point_3 s=CGAL::centroid(points[t[0]],points[t[1]],points[t[2]]);
  if(CGAL::orientation(points[t[0]],points[t[1]],points[t[2]],q)==CGAL::COPLANAR)return false;
  double a[3],b[3];{const auto sb=s.bbox(),qb=q.bbox();for(int k=0;k<3;++k){a[k]=(sb.min(k)+sb.max(k))/2;b[k]=(qb.min(k)+qb.max(k))/2;}}
  long total=0;std::vector<std::size_t> stack{0};
  while(!stack.empty()){
   const Node& node=bvh.nodes[stack.back()];stack.pop_back();
   if(!segmentMeetsBox(a,b,node.box,margin))continue;
   if(node.count==0){stack.push_back(node.left);stack.push_back(node.right);continue;}
   for(std::size_t i=node.first;i<node.first+node.count;++i){
    const std::size_t g=bvh.order[i];if(g==f||!segmentMeetsBox(a,b,boxes[g],margin))continue;
    const auto& p=points[faces[g].v[0]];const auto& r=points[faces[g].v[1]];const auto& u=points[faces[g].v[2]];
    const auto os=CGAL::orientation(p,r,u,s),oq=CGAL::orientation(p,r,u,q);
    if(oq==CGAL::COPLANAR)return false;
    if(os==oq||os==CGAL::COPLANAR)continue;
    const auto e1=CGAL::orientation(s,q,p,r),e2=CGAL::orientation(s,q,r,u),e3=CGAL::orientation(s,q,u,p);
    const bool positive=e1!=CGAL::NEGATIVE&&e2!=CGAL::NEGATIVE&&e3!=CGAL::NEGATIVE,negative=e1!=CGAL::POSITIVE&&e2!=CGAL::POSITIVE&&e3!=CGAL::POSITIVE;
    if(!positive&&!negative)continue;
    if(e1==CGAL::COPLANAR||e2==CGAL::COPLANAR||e3==CGAL::COPLANAR)return false;
    total+=os==CGAL::POSITIVE?faces[g].weight:-faces[g].weight;
   }
  }
  winding=-total;return true;
 };
 std::vector<std::vector<std::size_t>> members(faces.size());
 for(std::size_t f=0;f<faces.size();++f)members[root(f)].push_back(f);
 std::vector<Triangle> kept;
 for(const auto& patch:members){
  if(patch.empty())continue;++patches;
  long front=0;bool known=false;
  // Fixed pseudo-random directions keep the result deterministic. A refined
  // surface always has general-position rays; the bound only stops a defect.
  for(std::size_t attempt=0;!known;++attempt){
   if(attempt>=64*patch.size())throw std::runtime_error("Solid reconstruction found no general-position ray for a surface patch; no result accepted");
   const std::size_t f=patch[attempt%patch.size()];
   const double angle=2.399963229728653*double(attempt+1),z=1-2*std::fmod(0.6180339887498949*double(attempt+1),1.0),radius=std::sqrt(std::max(0.0,1-z*z));
   const EK::Point_3 q(centre[0]+reach*radius*std::cos(angle),centre[1]+reach*radius*std::sin(angle),centre[2]+reach*z);
   long winding;++rays;
   if(!windingToward(f,q,winding)){++retries;continue;}
   const auto& t=faces[f].v;
   front=CGAL::orientation(points[t[0]],points[t[1]],points[t[2]],q)==CGAL::POSITIVE?winding:winding-faces[f].weight;known=true;
  }
  const long back=front+faces[patch.front()].weight;
  if((front>0)==(back>0)){interior+=patch.size();continue;}
  for(auto f:patch){auto t=faces[f].v;if(front>0)std::swap(t[1],t[2]);kept.push_back(t);}
 }
 const std::size_t boundary=kept.size();
 if(kept.empty())throw std::runtime_error("Solid reconstruction encloses no volume; no result accepted");

 // Exact intersection points round to doubles; snap rounding then removes any
 // crossing that rounding created. Source vertices are doubles and stay put.
 stage("round");
 std::vector<K::Point_3> rounded;std::vector<std::size_t> index(points.size(),SIZE_MAX);
 for(auto& t:kept)for(auto& v:t){if(index[v]==SIZE_MAX){index[v]=rounded.size();rounded.emplace_back(CGAL::to_double(points[v].x()),CGAL::to_double(points[v].y()),CGAL::to_double(points[v].z()));}v=index[v];}
 points.clear();points.shrink_to_fit();
 if(!PMP::autorefine_triangle_soup(rounded,kept,CGAL::parameters::apply_iterative_snap_rounding(true)))
  throw std::runtime_error("Rounding the reconstructed surface to doubles left intersections; no result accepted");
 if(!PMP::is_polygon_soup_a_polygon_mesh(kept))throw std::runtime_error("The reconstructed solid touches itself along an edge or at a vertex, so its boundary is not a manifold; no result accepted");
 mesh.clear();PMP::polygon_soup_to_polygon_mesh(rounded,kept,mesh);
 const Collapse collapse=collapseTinyTriangles(mesh,std::move(source));
 if(collapse.remaining)throw std::runtime_error(std::to_string(collapse.remaining)+" reconstructed triangles stay below SAAM's minimum height and cannot be collapsed; no result accepted");
 std::ostringstream report;
 report<<"{\"closing\":{\"method\":\"opposed-sheet-plane/1\",\"toleranceMm\":"<<closeMm<<",\"groups\":"<<closing.groups<<",\"faces\":"<<closing.faces
  <<",\"movedVertices\":"<<closing.moved<<",\"unmovedVertices\":"<<closing.unmoved<<",\"maxDisplacementMm\":"<<closing.maxMoveMm<<"}"
  <<",\"reversedOrientation\":"<<(reversed?"true":"false")<<",\"refinedTriangles\":"<<refined<<",\"coincidentGroups\":"<<coincident
  <<",\"cancelledTriangles\":"<<cancelled<<",\"cancelledAreaMm2\":"<<cancelledArea<<",\"patches\":"<<patches<<",\"rays\":"<<rays<<",\"rayRetries\":"<<retries
  <<",\"boundaryTriangles\":"<<boundary<<",\"interiorTriangles\":"<<interior<<",\"collapsedEdges\":"<<collapse.edges<<",\"maxCollapseMm\":"<<collapse.maxMoveMm<<"}";
 return report.str();
}

int main(int argc,char** argv){
 try{
  if(argc==2&&std::string(argv[1])=="--version"){std::cout<<"saam-cgal-mesh-repair/1 CGAL "<<CGAL_VERSION_STR<<"\n";return 0;}
  if(argc!=6)throw std::runtime_error("Expected input.off output.off maxHoleEdges maxHoleDiameterMm closeMm");
  const auto started=std::chrono::steady_clock::now();
  const auto max_edges=std::stoull(argv[3]);const double max_diameter=std::stod(argv[4]),close_mm=std::stod(argv[5]);
  if(!std::isfinite(max_diameter)||max_diameter<0)throw std::runtime_error("Invalid hole limits");
  if(!std::isfinite(close_mm)||close_mm<0)throw std::runtime_error("Invalid closing distance");
  stage("orient");
  std::vector<K::Point_3> points;std::vector<std::vector<std::size_t>> faces;
  if(!CGAL::IO::read_polygon_soup(argv[1],points,faces))throw std::runtime_error("Cannot read repair input");
  const auto before_points=points.size(),before_faces=faces.size();
  const bool oriented=PMP::orient_polygon_soup(points,faces);
  const auto split_vertices=points.size()-before_points;
  if(!PMP::is_polygon_soup_a_polygon_mesh(faces))throw std::runtime_error("Cannot resolve polygon soup topology");
  Mesh mesh;PMP::polygon_soup_to_polygon_mesh(points,faces,mesh);
  points.clear();points.shrink_to_fit();faces.clear();faces.shrink_to_fit();
  const auto stitched=PMP::stitch_borders(mesh);
  stage("boundaries");
  std::vector<Mesh::Halfedge_index> borders;CGAL::extract_boundary_cycles(mesh,std::back_inserter(borders));
  std::size_t filled=0,added=0,skipped=0;
  for(auto h:borders){
   if(!mesh.is_border(h))continue;
   std::size_t count=0;auto current=h;double lo[3]={INFINITY,INFINITY,INFINITY},hi[3]={-INFINITY,-INFINITY,-INFINITY};
   do{const auto& p=mesh.point(mesh.target(current));for(int k=0;k<3;++k){const double v=CGAL::to_double(p[k]);lo[k]=std::min(lo[k],v);hi[k]=std::max(hi[k],v);}++count;current=mesh.next(current);}while(current!=h);
   const double diameter=std::sqrt((hi[0]-lo[0])*(hi[0]-lo[0])+(hi[1]-lo[1])*(hi[1]-lo[1])+(hi[2]-lo[2])*(hi[2]-lo[2]));
   if(max_edges==0||count>max_edges||diameter>max_diameter){++skipped;continue;}
   std::vector<Mesh::Face_index> patch;
   PMP::triangulate_hole(mesh,h,CGAL::parameters::face_output_iterator(std::back_inserter(patch)));
   if(!patch.empty()){++filled;added+=patch.size();}
  }
  if(!CGAL::is_closed(mesh))throw std::runtime_error("Open boundaries remain; hole filling requires explicit maxHoleEdges and maxHoleDiameterMm");
  mesh.collect_garbage();
  stage("intersections");
  const bool intersected=PMP::does_self_intersect(mesh);
  const std::string reconstruction=intersected?reconstruct(mesh,close_mm):"null";
  stage("native-validation");
  if(!CGAL::is_closed(mesh))throw std::runtime_error("Repair output is not closed; no result accepted");
  if(PMP::does_self_intersect(mesh))throw std::runtime_error("CGAL output still intersects; no result accepted");
  mesh.collect_garbage();
  std::ofstream output(argv[2]);output<<std::setprecision(17)<<"OFF\n"<<mesh.number_of_vertices()<<' '<<mesh.number_of_faces()<<" 0\n";
  for(auto v:mesh.vertices())output<<mesh.point(v)<<'\n';
  for(auto f:mesh.faces()){auto h=mesh.halfedge(f);output<<"3 "<<mesh.target(h).idx()<<' '<<mesh.target(mesh.next(h)).idx()<<' '<<mesh.target(mesh.next(mesh.next(h))).idx()<<'\n';}
  output.close();if(!output)throw std::runtime_error("Cannot write repair output");
  std::cout<<"{\"backend\":\"CGAL "<<CGAL_VERSION_STR<<"\",\"method\":\"cgal-solid-repair/3\",\"inputTriangles\":"<<before_faces
   <<",\"orientReturned\":"<<(oriented?"true":"false")<<",\"splitVertices\":"<<split_vertices<<",\"stitchedPairs\":"<<stitched
   <<",\"holesFilled\":"<<filled<<",\"holeTrianglesAdded\":"<<added<<",\"holesSkipped\":"<<skipped
   <<",\"selfIntersectionsRepaired\":"<<(intersected?"true":"false")<<",\"reconstruction\":"<<reconstruction
   <<",\"outputTriangles\":"<<mesh.number_of_faces()<<",\"nativeSeconds\":"<<std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count()<<"}\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}return 0;
}
